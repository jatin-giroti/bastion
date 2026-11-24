"""
Bastion — FastAPI service.

Endpoints
  GET  /api/v1/manifest/{brand_id}
  POST /api/v1/review/{brand_id}
  POST /api/v1/flags/{submission_id}/override
  POST /api/v1/flags/{submission_id}/accept      (extra: persists accepted fixes)
  POST /api/v1/manifest/{brand_id}/accept-pr
  GET  /api/v1/health
  GET  /api/v1/manifests                         (Round 3: list brands)
  POST /api/v1/manifests/ingest-pdf              (Round 3: compile a brand PDF into a manifest + RAG chunks)
  POST /api/v1/webhooks/test                     (Round 3: send a Slack/Teams test event)

Storage: MongoDB Atlas via Motor (database `bastion_db`) when MONGODB_URI is set,
otherwise an automatic in-memory fallback so the app always runs.
"""
import asyncio
import copy
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from agents import generate_guideline_pr, get_client, merge_clarification_into_manifest, run_triad  # noqa: E402
from deterministic import run_deterministic_text_checks, run_deterministic_wcag_checks  # noqa: E402
from ingestion import compile_manifest_from_pdf, send_governance_webhook  # noqa: E402
from models import (  # noqa: E402
    DEFAULT_BRAND_MANIFEST,
    MANIFEST_CACHE,
    AuditRequest,
    AuditResponse,
    OverrideRequest,
    ViolationItem,
    clone_manifest,
    compute_compliance_score,
    derive_workflow_state,
    get_cached_manifest,
    set_cached_manifest,
    utc_now_iso,
    validate_exact_quotes,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("bastion.main")

DB_NAME = "bastion_db"
COLLECTIONS = ("brand_manifests", "content_submissions", "audit_flags", "governance_telemetry")
OVERRIDE_THRESHOLD = 3
_SEVERITY_RANK = {"CRITICAL_LEGAL": 0, "MEDIUM": 1, "LOW": 2}

# Which roles may override which flag categories. CRITICAL_LEGAL flags need a Legal Reviewer.
OVERRIDE_CATEGORIES = {
    "Creator": set(),
    "Brand Manager": {"TONE", "TERMINOLOGY", "FACT_CLAIM", "ACCESSIBILITY"},
    "Legal Reviewer": {"TONE", "TERMINOLOGY", "FACT_CLAIM", "ACCESSIBILITY"},
    "Accessibility Reviewer": {"ACCESSIBILITY"},
}
PR_ACCEPT_ROLES = {"Brand Manager", "Legal Reviewer"}


def can_override(role: str, flag: ViolationItem) -> bool:
    categories = OVERRIDE_CATEGORIES.get(role)
    if not categories or flag.category not in categories:
        return False
    return flag.severity != "CRITICAL_LEGAL" or role == "Legal Reviewer"


# -----------------------------------------------------------------------------
# Storage: Motor with automatic in-memory fallback
# -----------------------------------------------------------------------------
def _matches(doc: dict, query: dict) -> bool:
    return all(doc.get(k) == v for k, v in query.items())


class Store:
    def __init__(self) -> None:
        self.uri = os.getenv("MONGODB_URI", "").strip()
        self.client = None
        self.db = None
        self.mode = "memory"
        self.mem: dict[str, list[dict]] = {name: [] for name in COLLECTIONS}

    async def connect(self) -> None:
        if not self.uri:
            logger.info("MONGODB_URI not set — using in-memory store")
            return
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            self.client = AsyncIOMotorClient(self.uri, serverSelectionTimeoutMS=4000)
            await self.client.admin.command("ping")
            self.db = self.client[DB_NAME]
            self.mode = "mongodb"
            await self.db["audit_flags"].create_index([("submission_id", 1), ("flag_id", 1)])
            await self.db["governance_telemetry"].create_index([("type", 1), ("brand_id", 1), ("rule_id", 1)])
            await self.db["content_submissions"].create_index("submission_id", unique=True)
            await self.db["brand_manifests"].create_index("brand_id", unique=True)
            logger.info("Connected to MongoDB database '%s'", DB_NAME)
        except Exception as exc:
            logger.warning("MongoDB unavailable (%s) — falling back to in-memory store", exc)
            self.db, self.mode = None, "memory"

    def _degrade(self, exc: Exception) -> None:
        logger.warning("MongoDB operation failed (%s) — switching to in-memory store", exc)
        self.db, self.mode = None, "memory"

    async def find_one(self, coll: str, query: dict) -> dict | None:
        if self.db is not None:
            try:
                return await self.db[coll].find_one(query, {"_id": 0})
            except Exception as exc:
                self._degrade(exc)
        for doc in self.mem[coll]:
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    async def find(self, coll: str, query: dict, limit: int = 500) -> list[dict]:
        if self.db is not None:
            try:
                return await self.db[coll].find(query, {"_id": 0}).limit(limit).to_list(length=limit)
            except Exception as exc:
                self._degrade(exc)
        return [copy.deepcopy(d) for d in self.mem[coll] if _matches(d, query)][:limit]

    async def insert(self, coll: str, doc: dict) -> None:
        if self.db is not None:
            try:
                await self.db[coll].insert_one(dict(doc))
                return
            except Exception as exc:
                self._degrade(exc)
        self.mem[coll].append(copy.deepcopy(doc))

    async def upsert(self, coll: str, query: dict, doc: dict) -> None:
        if self.db is not None:
            try:
                await self.db[coll].replace_one(query, dict(doc), upsert=True)
                return
            except Exception as exc:
                self._degrade(exc)
        for i, existing in enumerate(self.mem[coll]):
            if _matches(existing, query):
                self.mem[coll][i] = copy.deepcopy(doc)
                return
        self.mem[coll].append(copy.deepcopy(doc))

    async def update(self, coll: str, query: dict, fields: dict) -> None:
        if self.db is not None:
            try:
                await self.db[coll].update_one(query, {"$set": fields})
                return
            except Exception as exc:
                self._degrade(exc)
        for doc in self.mem[coll]:
            if _matches(doc, query):
                doc.update(copy.deepcopy(fields))
                return

    async def update_many(self, coll: str, query: dict, fields: dict) -> None:
        if self.db is not None:
            try:
                await self.db[coll].update_many(query, {"$set": fields})
                return
            except Exception as exc:
                self._degrade(exc)
        for doc in self.mem[coll]:
            if _matches(doc, query):
                doc.update(copy.deepcopy(fields))

    async def count(self, coll: str, query: dict) -> int:
        if self.db is not None:
            try:
                return await self.db[coll].count_documents(query)
            except Exception as exc:
                self._degrade(exc)
        return sum(1 for d in self.mem[coll] if _matches(d, query))


store = Store()
_pr_lock = asyncio.Lock()  # serialises override -> count -> PR so the PR is created exactly once

# RAG chunks per brand (kept beside, not inside, the validated BrandManifest)
RAG_CHUNKS_STORE: dict[str, list[dict]] = {}
MAX_PDF_BYTES = 15 * 1024 * 1024

_BG_TASKS: set = set()


def _fire_webhook(event_type: str, payload: dict) -> None:
    """Send a governance webhook in the background so Slack/Teams latency never delays an API response."""

    async def _run() -> None:
        try:
            result = await send_governance_webhook(event_type, payload)
            if result.get("sent"):
                logger.info("Governance webhook '%s' delivered", event_type)
            elif result.get("reason") != "no_webhook_configured":
                logger.warning("Governance webhook '%s' not delivered: %s", event_type, result)
        except Exception as exc:  # never let a notification break governance
            logger.warning("Governance webhook '%s' crashed: %s", event_type, exc)

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        return
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


# -----------------------------------------------------------------------------
# Manifest access (in-memory cache first, store second)
# -----------------------------------------------------------------------------
async def load_manifest(brand_id: str) -> dict | None:
    cached = get_cached_manifest(brand_id)
    if cached is not None:
        return cached
    doc = await store.find_one("brand_manifests", {"brand_id": brand_id})
    if doc is None:
        return None
    try:
        validated = set_cached_manifest(brand_id, doc)
        if doc.get("rag_chunks"):
            RAG_CHUNKS_STORE[brand_id] = doc["rag_chunks"]
        return validated
    except Exception as exc:
        logger.error("Stored manifest for %s is invalid: %s", brand_id, exc)
        return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    await store.connect()
    for doc in await store.find("brand_manifests", {}):
        try:
            set_cached_manifest(doc["brand_id"], doc)
            if doc.get("rag_chunks"):
                RAG_CHUNKS_STORE[doc["brand_id"]] = doc["rag_chunks"]
        except Exception as exc:
            logger.warning("Skipping invalid stored manifest: %s", exc)
    default_id = DEFAULT_BRAND_MANIFEST["brand_id"]
    if await store.find_one("brand_manifests", {"brand_id": default_id}) is None:
        await store.upsert("brand_manifests", {"brand_id": default_id}, get_cached_manifest(default_id))
    logger.info("Bastion ready — store=%s claude=%s", store.mode, "live" if get_client() else "fallback")
    yield


app = FastAPI(title="Bastion — Brand-as-Code Governance Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _flag_from_doc(doc: dict) -> ViolationItem:
    return ViolationItem.model_validate({k: doc[k] for k in ViolationItem.model_fields if k in doc})


async def _refresh_submission(submission_id: str) -> tuple[str, int]:
    docs = await store.find("audit_flags", {"submission_id": submission_id})
    flags = [_flag_from_doc(d) for d in docs]
    status = derive_workflow_state(flags).value
    score = compute_compliance_score(flags)
    await store.update("content_submissions", {"submission_id": submission_id},
                       {"status": status, "compliance_score": score, "updated_at": utc_now_iso()})
    return status, score


def _sort_flags(draft: str, flags: list[ViolationItem]) -> list[ViolationItem]:
    def key(f: ViolationItem):
        pos = draft.find(f.exact_quote)
        return (_SEVERITY_RANK.get(f.severity, 9), pos if pos >= 0 else 10**9)

    return sorted(flags, key=key)


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.get("/")
@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "store": store.mode,
        "claude": "live" if get_client() else "deterministic-fallback",
        "brands_cached": list(MANIFEST_CACHE.keys()),
    }


@app.get("/api/v1/manifest/{brand_id}")
async def get_manifest(brand_id: str):
    manifest = await load_manifest(brand_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"No BrandManifest for brand_id '{brand_id}'")
    return {**manifest, "rag_chunks": RAG_CHUNKS_STORE.get(brand_id, [])}


@app.get("/api/v1/manifests")
async def list_manifests():
    brands = [
        {
            "brand_id": brand_id,
            "brand_name": m.get("brand_name", brand_id),
            "version": m.get("version"),
            "rag_chunk_count": len(RAG_CHUNKS_STORE.get(brand_id, [])),
        }
        for brand_id, m in MANIFEST_CACHE.items()
    ]
    return {"manifests": sorted(brands, key=lambda b: str(b["brand_name"]).lower())}


@app.post("/api/v1/manifests/ingest-pdf")
async def ingest_pdf(brand_name: str = Form(...), file: UploadFile = File(...)):
    name = brand_name.strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=422, detail="brand_name must be between 1 and 80 characters.")
    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF is larger than the 15 MB limit.")
    if b"%PDF-" not in data[:1024]:
        raise HTTPException(status_code=415, detail="The uploaded file is not a PDF.")

    try:
        compiled = await compile_manifest_from_pdf(name, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("PDF ingestion failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not compile this PDF into a manifest.")

    rag_chunks = compiled.pop("rag_chunks", [])
    compiled_by = compiled.pop("compiled_by", "heuristic")
    try:
        validated = set_cached_manifest(compiled["brand_id"], compiled)
    except Exception as exc:
        logger.error("Compiled manifest failed validation: %s", exc)
        raise HTTPException(status_code=422, detail="The compiled manifest did not pass validation.")

    RAG_CHUNKS_STORE[validated["brand_id"]] = rag_chunks
    await store.upsert("brand_manifests", {"brand_id": validated["brand_id"]}, {**validated, "rag_chunks": rag_chunks})
    return {**validated, "rag_chunks": rag_chunks, "compiled_by": compiled_by}


class WebhookTestRequest(BaseModel):
    webhook_url: str | None = None
    event_type: str = "test"
    brand_id: str


@app.post("/api/v1/webhooks/test")
async def webhooks_test(req: WebhookTestRequest):
    manifest = await load_manifest(req.brand_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"No BrandManifest for brand_id '{req.brand_id}'")
    base = {"brand_id": req.brand_id, "brand_name": manifest.get("brand_name", req.brand_id)}
    if req.event_type == "legal_hold":
        payload = {**base, "submission_id": "sub_test", "status": "LEGAL_HOLD", "compliance_score": 0, "critical_flag_count": 2,
                   "critical_flags": [{"rule_id": "TERM-03", "exact_quote": "risk-free"},
                                      {"rule_id": "TERM-02", "exact_quote": "100% guaranteed ROI"}]}
    elif req.event_type == "guideline_pr":
        payload = {**base, "rule_id": "TERM-06", "override_count": 3, "pr_id": "PR-TEST0001",
                   "rationale": "Sample guideline PR generated by the webhook test."}
    else:
        payload = base
    result = await send_governance_webhook(req.event_type, payload, req.webhook_url)
    return {"event_type": req.event_type, "brand_id": req.brand_id, **result}


@app.post("/api/v1/review/{brand_id}")
async def review(brand_id: str, req: AuditRequest):
    t_start = time.perf_counter()
    manifest = await load_manifest(brand_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"No BrandManifest for brand_id '{brand_id}'")

    # 1) Deterministic pre-flight (no network, no LLM)
    t_pre = time.perf_counter()
    text_flags = run_deterministic_text_checks(req.draft_text, manifest)
    wcag = run_deterministic_wcag_checks(
        req.fg_hex, req.bg_hex, req.has_alt_text, req.alt_text, req.image_b64, manifest
    )
    preflight_ms = (time.perf_counter() - t_pre) * 1000
    preflight = text_flags + wcag["flags"]

    # 2) Parallel Claude triad (falls back deterministically per agent)
    triad = await run_triad(
        req.draft_text, manifest, preflight, wcag,
        fg_hex=req.fg_hex, bg_hex=req.bg_hex, alt_text=req.alt_text, image_b64=req.image_b64,
    )

    # 3) Exact-quote validation, scoring, workflow state
    flags = validate_exact_quotes(req.draft_text, preflight + triad["flags"])
    flags = _sort_flags(req.draft_text, flags)
    score = compute_compliance_score(flags)
    status = derive_workflow_state(flags).value

    submission_id = f"sub_{uuid.uuid4().hex[:12]}"
    response = AuditResponse(
        submission_id=submission_id,
        brand_id=brand_id,
        status=status,
        compliance_score=score,
        preflight_latency_ms=round(preflight_ms, 3),
        total_latency_ms=round((time.perf_counter() - t_start) * 1000, 3),
        contrast_ratio=wcag["contrast_ratio"],
        wcag_level=wcag["wcag_level"],
        flags=flags,
    )

    # 4) Persist (never fail the review because storage is slow or down)
    try:
        await store.insert("content_submissions", {
            "submission_id": submission_id, "brand_id": brand_id, "manifest_version": manifest.get("version"),
            "draft_text": req.draft_text, "creator_role": req.creator_role,
            "fg_hex": req.fg_hex, "bg_hex": req.bg_hex,
            "has_alt_text": req.has_alt_text, "alt_text": req.alt_text, "has_image": bool(req.image_b64),
            "status": status, "compliance_score": score, "flag_ids": [f.flag_id for f in flags],
            "created_at": utc_now_iso(),
        })
        for f in flags:
            await store.insert("audit_flags", {**f.model_dump(), "submission_id": submission_id, "brand_id": brand_id})
    except Exception as exc:  # pragma: no cover
        logger.error("Failed to persist submission %s: %s", submission_id, exc)

    if status == "LEGAL_HOLD":
        critical = [f for f in flags if f.severity == "CRITICAL_LEGAL" and f.status == "OPEN"]
        _fire_webhook("legal_hold", {
            "brand_id": brand_id, "brand_name": manifest.get("brand_name", brand_id), "submission_id": submission_id,
            "status": status, "compliance_score": score, "critical_flag_count": len(critical),
            "critical_flags": [{"rule_id": f.rule_id, "exact_quote": f.exact_quote} for f in critical[:5]],
        })

    payload = response.model_dump(mode="json")
    payload["triad"] = {"mode": triad["mode"], "agents": triad["agents"]}
    payload["manifest_version"] = manifest.get("version")
    return payload


@app.post("/api/v1/flags/{submission_id}/override")
async def override_flag(submission_id: str, req: OverrideRequest):
    reason = req.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="An override needs a reason (at least 3 characters).")

    doc = await store.find_one("audit_flags", {"submission_id": submission_id, "flag_id": req.flag_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Flag not found for this submission.")
    flag = _flag_from_doc(doc)
    if flag.rule_id != req.rule_id:
        raise HTTPException(status_code=400, detail="rule_id does not match the flag.")
    if not can_override(req.reviewer_role, flag):
        needs = "a Legal Reviewer" if flag.severity == "CRITICAL_LEGAL" else "a Brand Manager or Legal Reviewer"
        if flag.category == "ACCESSIBILITY" and flag.severity != "CRITICAL_LEGAL":
            needs = "an Accessibility Reviewer, Brand Manager or Legal Reviewer"
        raise HTTPException(status_code=403, detail=f"{req.reviewer_role} cannot override {flag.rule_id}; it needs {needs}.")

    brand_id = doc["brand_id"]
    scope = {"type": "override", "brand_id": brand_id, "rule_id": flag.rule_id, "consumed": False}

    if flag.status == "OVERRIDDEN":  # idempotent: never double-count a repeated click
        status, score = await _refresh_submission(submission_id)
        return {
            "flag": {**flag.model_dump()}, "override_count": await store.count("governance_telemetry", scope),
            "threshold": OVERRIDE_THRESHOLD, "pr_created": False, "guideline_pr": None,
            "status": status, "compliance_score": score,
        }

    await store.update("audit_flags", {"submission_id": submission_id, "flag_id": req.flag_id},
                       {"status": "OVERRIDDEN", "overridden_by": req.reviewer_role, "override_reason": reason})
    await store.insert("governance_telemetry", {
        "type": "override", "event_id": f"ovr_{uuid.uuid4().hex[:12]}", "brand_id": brand_id,
        "submission_id": submission_id, "flag_id": req.flag_id, "rule_id": flag.rule_id,
        "reviewer_role": req.reviewer_role, "reason": reason, "consumed": False, "created_at": utc_now_iso(),
    })

    pr, pr_created = None, False
    async with _pr_lock:
        count = await store.count("governance_telemetry", scope)
        if count >= OVERRIDE_THRESHOLD:
            marker_q = {"type": "pr_marker", "brand_id": brand_id, "rule_id": flag.rule_id}
            marker = await store.find_one("governance_telemetry", marker_q)
            if marker and marker.get("pr_generated_at"):  # idempotent: PR already exists for this rule
                pr = await store.find_one("governance_telemetry", {"type": "guideline_pr", "pr_id": marker["pr_id"]})
            else:
                manifest = await load_manifest(brand_id)
                events = await store.find("governance_telemetry", scope)
                reasons = [e["reason"] for e in sorted(events, key=lambda e: e.get("created_at", ""))]
                pr = await generate_guideline_pr(flag.rule_id, reasons, manifest, count)
                pr["brand_id"] = brand_id
                await store.insert("governance_telemetry", {"type": "guideline_pr", **pr})
                await store.upsert("governance_telemetry", marker_q, {
                    **marker_q, "pr_generated_at": utc_now_iso(), "pr_id": pr["pr_id"],
                })
                pr_created = True

    if pr_created and pr:
        _fire_webhook("guideline_pr", {
            "brand_id": brand_id, "brand_name": (get_cached_manifest(brand_id) or {}).get("brand_name", brand_id),
            "rule_id": flag.rule_id, "override_count": count, "pr_id": pr.get("pr_id"),
            "rationale": pr.get("rationale", ""), "sample_reasons": pr.get("sample_reasons", []),
        })

    status, score = await _refresh_submission(submission_id)
    return {
        "flag": {**flag.model_dump(), "status": "OVERRIDDEN"},
        "override_count": count,
        "threshold": OVERRIDE_THRESHOLD,
        "pr_created": pr_created,
        "guideline_pr": pr,
        "status": status,
        "compliance_score": score,
    }


class AcceptFlagRequest(BaseModel):
    flag_id: str


@app.post("/api/v1/flags/{submission_id}/accept")
async def accept_flag(submission_id: str, req: AcceptFlagRequest):
    doc = await store.find_one("audit_flags", {"submission_id": submission_id, "flag_id": req.flag_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Flag not found for this submission.")
    await store.update("audit_flags", {"submission_id": submission_id, "flag_id": req.flag_id}, {"status": "ACCEPTED"})
    status, score = await _refresh_submission(submission_id)
    return {"flag_id": req.flag_id, "flag_status": "ACCEPTED", "status": status, "compliance_score": score}


class AcceptPRRequest(BaseModel):
    pr_id: str
    reviewer_role: str = "Brand Manager"


@app.post("/api/v1/manifest/{brand_id}/accept-pr")
async def accept_pr(brand_id: str, req: AcceptPRRequest):
    if req.reviewer_role not in PR_ACCEPT_ROLES:
        raise HTTPException(status_code=403, detail="Only a Brand Manager or Legal Reviewer can accept a guideline PR.")
    pr_q = {"type": "guideline_pr", "pr_id": req.pr_id}
    pr = await store.find_one("governance_telemetry", pr_q)
    if pr is None:
        raise HTTPException(status_code=404, detail="Guideline PR not found.")
    if pr.get("brand_id") != brand_id:
        raise HTTPException(status_code=400, detail="This PR belongs to a different brand.")
    if pr.get("status") != "OPEN":
        raise HTTPException(status_code=409, detail=f"This PR is already {pr.get('status')}.")

    base = clone_manifest(brand_id)
    if base is None:
        loaded = await load_manifest(brand_id)
        if loaded is None:
            raise HTTPException(status_code=404, detail=f"No BrandManifest for brand_id '{brand_id}'")
        base = copy.deepcopy(loaded)

    now = utc_now_iso()
    merged = merge_clarification_into_manifest(base, pr, now)  # bumps version + updated_at
    validated = set_cached_manifest(brand_id, merged)          # refreshes MANIFEST_CACHE (and recompiles regex keys)
    await store.upsert("brand_manifests", {"brand_id": brand_id},
                       {**validated, "rag_chunks": RAG_CHUNKS_STORE.get(brand_id, [])})

    await store.update("governance_telemetry", pr_q, {"status": "ACCEPTED", "accepted_at": now, "accepted_by": req.reviewer_role})
    await store.update_many(
        "governance_telemetry",
        {"type": "override", "brand_id": brand_id, "rule_id": pr["rule_id"], "consumed": False},
        {"consumed": True},
    )
    await store.update(
        "governance_telemetry",
        {"type": "pr_marker", "brand_id": brand_id, "rule_id": pr["rule_id"]},
        {"pr_generated_at": None},
    )
    return {"manifest": validated, "guideline_pr": {**pr, "status": "ACCEPTED", "accepted_at": now}}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
