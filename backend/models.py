"""
Bastion — shared data contracts, default brand manifest, in-memory manifest cache,
and exact-quote validation.

Everything here is pure Python (no network I/O) so it can be imported by both the
deterministic pre-flight engine and the FastAPI layer.
"""
import copy
import difflib
import logging
import re
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger("bastion.models")

# -----------------------------------------------------------------------------
# Literals / enums
# -----------------------------------------------------------------------------
Category = Literal["TONE", "FACT_CLAIM", "ACCESSIBILITY", "TERMINOLOGY"]
Severity = Literal["LOW", "MEDIUM", "CRITICAL_LEGAL"]
FlagStatus = Literal["OPEN", "ACCEPTED", "OVERRIDDEN"]


class WorkflowState(str, Enum):
    DRAFT = "DRAFT"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    LEGAL_HOLD = "LEGAL_HOLD"
    APPROVED = "APPROVED"


class Role(str, Enum):
    CREATOR = "Creator"
    BRAND_MANAGER = "Brand Manager"
    LEGAL_REVIEWER = "Legal Reviewer"
    ACCESSIBILITY_REVIEWER = "Accessibility Reviewer"


# Categories whose `exact_quote` may reference a non-text element (hex colors, image
# regions, alt-text state) and therefore cannot be substring-checked against draft_text.
NON_TEXT_CATEGORIES = {"ACCESSIBILITY"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_flag_id() -> str:
    return f"flag_{uuid.uuid4().hex[:12]}"


# -----------------------------------------------------------------------------
# Pydantic schemas
# -----------------------------------------------------------------------------
class FactItem(BaseModel):
    claim_id: str
    category: str
    approved_statement: str
    allowed_metrics: list[str] = Field(default_factory=list)
    source_citation: str
    expires_at: str  # ISO date, e.g. "2027-03-31"


class BrandManifest(BaseModel):
    brand_id: str
    brand_name: str
    version: str
    voice_rules: list[dict] = Field(default_factory=list)
    banned_terms: list[dict] = Field(default_factory=list)
    approved_hex_palette: list[str] = Field(default_factory=list)
    wcag_min_ratio: float = 4.5
    fact_ledger: list[FactItem] = Field(default_factory=list)
    updated_at: str


class ViolationItem(BaseModel):
    # default_factory so LLM agents never need to invent IDs
    flag_id: str = Field(default_factory=new_flag_id)
    category: Category
    rule_id: str  # e.g. TERM-01 | CLAIM-04 | WCAG-02 | TONE-03
    rule_citation: str
    exact_quote: str
    explanation: str
    surgical_fix: str
    severity: Severity
    status: FlagStatus = "OPEN"


class AuditRequest(BaseModel):
    brand_id: str
    draft_text: str = Field(max_length=100_000)
    fg_hex: str = "#FFFFFF"
    bg_hex: str = "#4F46E5"
    has_alt_text: bool = True
    alt_text: str = ""
    image_b64: str | None = None
    creator_role: str = "Creator"


class AuditResponse(BaseModel):
    submission_id: str
    brand_id: str
    status: str  # WorkflowState value
    compliance_score: int = Field(ge=0, le=100)
    preflight_latency_ms: float
    total_latency_ms: float
    contrast_ratio: float
    wcag_level: str  # "AAA" | "AA" | "FAIL"
    flags: list[ViolationItem] = Field(default_factory=list)


class OverrideRequest(BaseModel):
    flag_id: str
    rule_id: str
    reviewer_role: str
    reason: str


class GuidelinePR(BaseModel):
    pr_id: str
    rule_id: str
    original_rule_text: str
    proposed_rule_text: str
    override_count: int
    sample_reasons: list[str] = Field(default_factory=list)
    rationale: str
    status: str = "OPEN"
    created_at: str = Field(default_factory=utc_now_iso)


# -----------------------------------------------------------------------------
# Workflow helpers (used by Block 2)
# -----------------------------------------------------------------------------
_SEVERITY_PENALTY = {"CRITICAL_LEGAL": 25, "MEDIUM": 10, "LOW": 3}


def compute_compliance_score(flags: list[ViolationItem]) -> int:
    """100 minus severity-weighted penalties for OPEN flags, floored at 0."""
    penalty = sum(_SEVERITY_PENALTY.get(f.severity, 0) for f in flags if f.status == "OPEN")
    return max(0, 100 - penalty)


def derive_workflow_state(flags: list[ViolationItem]) -> WorkflowState:
    """
    LEGAL_HOLD is triggered automatically if any OPEN flag is CRITICAL_LEGAL.
    Otherwise NEEDS_REVIEW if any flag is still OPEN. A fully resolved/clean draft
    returns APPROVED (Block 2 may additionally gate this on reviewer role).
    """
    open_flags = [f for f in flags if f.status == "OPEN"]
    if any(f.severity == "CRITICAL_LEGAL" for f in open_flags):
        return WorkflowState.LEGAL_HOLD
    if open_flags:
        return WorkflowState.NEEDS_REVIEW
    return WorkflowState.APPROVED


# -----------------------------------------------------------------------------
# Exact-quote validation (kills LLM-hallucinated quotes)
# -----------------------------------------------------------------------------
_QUOTE_STRIP = " \t\r\n\"'\u201c\u201d\u2018\u2019`"
_ELLIPSIS_RX = re.compile(r"^(?:\.\.\.|\u2026)+|(?:\.\.\.|\u2026)+$")


def _snap_quote(draft_text: str, quote: str, fuzzy_threshold: float) -> str | None:
    """
    Return the exact substring of draft_text that `quote` refers to, or None.
    Cascade: exact -> strip wrapper quotes/ellipses -> case-insensitive /
    whitespace-flexible regex -> fuzzy word-window match (SequenceMatcher).
    """
    if not quote or not quote.strip():
        return None

    idx = draft_text.find(quote)
    if idx != -1:
        return draft_text[idx: idx + len(quote)]

    cleaned = _ELLIPSIS_RX.sub("", quote.strip(_QUOTE_STRIP)).strip(_QUOTE_STRIP)
    if not cleaned:
        return None
    idx = draft_text.find(cleaned)
    if idx != -1:
        return draft_text[idx: idx + len(cleaned)]

    tokens = cleaned.split()
    if not tokens:
        return None
    flexible = re.compile(r"\s+".join(re.escape(t) for t in tokens), re.IGNORECASE)
    m = flexible.search(draft_text)
    if m:
        return draft_text[m.start(): m.end()]

    # Fuzzy: slide a word window (n-1, n, n+1 words) over the draft.
    words = [(m.start(), m.end(), m.group().lower()) for m in re.finditer(r"\S+", draft_text)]
    n = len(tokens)
    if not words or len(words) > 20_000:
        return None
    target = " ".join(tokens).lower()
    matcher = difflib.SequenceMatcher(autojunk=False)
    matcher.set_seq2(target)
    best_ratio, best_span = 0.0, None
    for size in {max(1, n - 1), n, n + 1}:
        if size > len(words):
            continue
        for start in range(len(words) - size + 1):
            candidate = " ".join(w[2] for w in words[start: start + size])
            matcher.set_seq1(candidate)
            if matcher.real_quick_ratio() < fuzzy_threshold or matcher.quick_ratio() < fuzzy_threshold:
                continue
            ratio = matcher.ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_span = (words[start][0], words[start + size - 1][1])
    if best_span and best_ratio >= fuzzy_threshold:
        return draft_text[best_span[0]: best_span[1]]
    return None


def validate_exact_quotes(
    draft_text: str,
    flags: list,
    fuzzy_threshold: float = 0.88,
) -> list[ViolationItem]:
    """
    Enforce `draft_text.find(flag.exact_quote) != -1` for every text-bearing flag.

    - Exact substring            -> kept unchanged.
    - Near-miss (case, spacing, wrapper quotes, ellipses, small typos)
                                 -> SNAPPED to the true substring of draft_text.
    - Unverifiable (hallucinated) -> DROPPED (and logged).
    - ACCESSIBILITY flags reference hex values / image regions / alt-text state, so
      they are passed through without substring validation.
    - Malformed flags (fail Pydantic validation) are dropped.
    - Duplicate (category, rule_id, exact_quote) flags are collapsed.
    """
    validated: list[ViolationItem] = []
    seen: set[tuple[str, str, str]] = set()

    for raw in flags:
        try:
            flag = raw if isinstance(raw, ViolationItem) else ViolationItem.model_validate(raw)
        except ValidationError as exc:
            logger.warning("Dropping malformed flag: %s", exc.errors()[:1])
            continue

        if flag.category not in NON_TEXT_CATEGORIES:
            snapped = _snap_quote(draft_text, flag.exact_quote, fuzzy_threshold)
            if snapped is None:
                logger.warning(
                    "Dropping hallucinated quote for %s: %r", flag.rule_id, flag.exact_quote[:80]
                )
                continue
            if snapped != flag.exact_quote:
                flag = flag.model_copy(update={"exact_quote": snapped})
            # Final hard guarantee (the contract):
            if draft_text.find(flag.exact_quote) == -1:
                continue

        key = (flag.category, flag.rule_id, flag.exact_quote)
        if key in seen:
            continue
        seen.add(key)
        validated.append(flag)

    return validated


# -----------------------------------------------------------------------------
# DEFAULT BRAND MANIFEST — fictional enterprise fintech/SaaS brand "Meridian Pay"
# -----------------------------------------------------------------------------
DEFAULT_BRAND_MANIFEST: dict = {
    "brand_id": "meridian-pay",
    "brand_name": "Meridian Pay",
    "version": "2.4.0",
    "updated_at": "2026-09-30T00:00:00+00:00",
    "approved_hex_palette": ["#0F172A", "#1E293B", "#4F46E5", "#10B981", "#F8FAFC"],
    "wcag_min_ratio": 4.5,
    "voice_rules": [
        # ---- Tone rules (evaluated by the Claude tone agent in Block 2) ----------
        {
            "rule_id": "TONE-01",
            "type": "tone",
            "name": "Confident, not boastful",
            "description": "State capabilities plainly with evidence. Avoid superlatives and "
                           "comparative boasting unless backed by the Approved Fact Ledger.",
            "tone_vector": {"formality": 0.65, "warmth": 0.55, "confidence": 0.80, "urgency": 0.10},
            "citation": "Section 2.1 — Voice & Tone (Brand Guidelines v2.4)",
        },
        {
            "rule_id": "TONE-02",
            "type": "tone",
            "name": "Plain language",
            "description": "Write for a finance lead, not a quant. Prefer short sentences and "
                           "concrete verbs; define jargon on first use.",
            "tone_vector": {"formality": 0.60, "warmth": 0.60, "confidence": 0.70, "urgency": 0.10},
            "citation": "Section 2.2 — Plain Language (Brand Guidelines v2.4)",
        },
        {
            "rule_id": "TONE-03",
            "type": "tone",
            "name": "No pressure tactics",
            "description": "Never manufacture urgency or fear of missing out (e.g. 'act now', "
                           "'last chance', 'don't miss out') in financial product messaging.",
            "tone_vector": {"formality": 0.65, "warmth": 0.50, "confidence": 0.70, "urgency": 0.05},
            "citation": "Section 2.4 — Responsible Persuasion (Brand Guidelines v2.4)",
        },
        {
            "rule_id": "TONE-04",
            "type": "tone",
            "name": "Inclusive & respectful",
            "description": "Avoid idioms, gendered defaults, and language that assumes "
                           "customer size, geography, or financial sophistication.",
            "tone_vector": {"formality": 0.60, "warmth": 0.70, "confidence": 0.65, "urgency": 0.10},
            "citation": "Section 2.6 — Inclusive Language (Brand Guidelines v2.4)",
        },
        # ---- Required disclaimers (evaluated deterministically) -------------------
        {
            "rule_id": "DISC-01",
            "type": "required_disclaimer",
            "category": "FACT_CLAIM",
            "severity": "CRITICAL_LEGAL",
            "trigger_patterns": [
                r"\breturns?\b", r"\bROI\b", r"\byields?\b", r"\bAPY\b", r"\bAPR\b",
                r"\binvest(?:ment|ments|ing)?\b", r"\bprofits?\b",
            ],
            "required_phrases": ["past performance", "results may vary"],
            "required_text": "past performance is not indicative of future results",
            "citation": "Section 5.3 — Required Financial Disclaimers (Legal Policy LP-12)",
            "explanation": "Copy that references returns, ROI, yield or investment must carry the "
                           "approved performance disclaimer.",
        },
        {
            "rule_id": "DISC-02",
            "type": "required_disclaimer",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "trigger_patterns": [r"\bFDIC\b", r"\bdeposits?\b", r"\binsured\b", r"\bbank[\s-]grade\b"],
            "required_phrases": ["not a bank"],
            "required_text": "Meridian Pay is a financial technology company, not a bank",
            "citation": "Section 5.5 — Regulatory Status Disclosure (Legal Policy LP-14)",
            "explanation": "Banking-adjacent language requires the regulatory status disclosure "
                           "so customers are not misled about deposit protection.",
        },
    ],
    "banned_terms": [
        {
            "rule_id": "TERM-01",
            "term": "#1 fastest in the world",
            "pattern": r"(?<![\w#])#\s?1\s+fastest(?:\s+in\s+the\s+world)?\b",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "replacement": "engineered for speed",
            "citation": "Section 3.1 — Prohibited Superlatives (Brand Guidelines v2.4)",
            "explanation": "Unsubstantiated absolute superlative. No third-party benchmark supports "
                           "a global #1 speed ranking.",
        },
        {
            "rule_id": "TERM-02",
            "term": "100% guaranteed ROI",
            "pattern": r"\b(?:100\s?%\s+)?guaranteed\s+(?:ROI|returns?)\b",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "replacement": "measurable ROI",
            "citation": "Section 3.2 — Prohibited Guarantees (Legal Policy LP-09)",
            "explanation": "Guaranteeing financial outcomes is prohibited; it creates misrepresentation "
                           "and securities-style liability.",
        },
        {
            "rule_id": "TERM-03",
            "term": "risk-free",
            "pattern": r"\brisk[\s-]?free\b",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "replacement": "lower-risk",
            "citation": "Section 3.3 — Prohibited Risk Claims (Legal Policy LP-09)",
            "explanation": "No financial product or payment rail is risk-free; use calibrated "
                           "risk language.",
        },
        {
            "rule_id": "TERM-04",
            "term": "zero fees forever",
            "pattern": r"\bzero[\s-]+fees?\s+(?:forever|for\s+life)\b",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "replacement": "transparent, published pricing",
            "citation": "Section 3.4 — Pricing Claims (Fact Ledger FACT-005)",
            "explanation": "Permanent fee waivers are not offered; pricing is published and can "
                           "change with volume tiers.",
        },
        {
            "rule_id": "TERM-05",
            "term": "instant global settlement",
            "pattern": r"\binstant\s+global\s+settlement\b",
            "category": "TERMINOLOGY",
            "severity": "CRITICAL_LEGAL",
            "replacement": "settlement in under 2 seconds for 98% of domestic rails (SLA v2.4)",
            "citation": "Section 4.2 — Approved Fact Ledger v2.4 (FACT-001)",
            "explanation": "Settlement is not instant or global; the approved claim is limited to "
                           "domestic rails with the SLA v2.4 percentile.",
        },
        {
            "rule_id": "TERM-06",
            "term": "hype vocabulary",
            "pattern": r"\b(?:game[\s-]?chang(?:er|ing)|revolutionary|disruptive|world[\s-]class)\b",
            "category": "TERMINOLOGY",
            "severity": "LOW",
            "replacement": "modern",
            "citation": "Section 3.7 — Hype Vocabulary (Brand Guidelines v2.4)",
            "explanation": "Hype adjectives conflict with the confident-not-boastful voice (TONE-01).",
        },
    ],
    "fact_ledger": [
        {
            "claim_id": "FACT-001",
            "category": "PERFORMANCE",
            "approved_statement": "Settlement completes in under 2 seconds for 98% of domestic rails (SLA v2.4)",
            "allowed_metrics": ["2 seconds", "98%", "domestic rails"],
            "source_citation": "Meridian Pay SLA v2.4, Section 3.1",
            "expires_at": "2027-03-31",
        },
        {
            "claim_id": "FACT-002",
            "category": "RELIABILITY",
            "approved_statement": "99.99% historical platform uptime across Q1-Q3 2026",
            "allowed_metrics": ["99.99%", "Q1-Q3 2026"],
            "source_citation": "Platform Status Audit Report, Q3 2026",
            "expires_at": "2026-12-31",
        },
        {
            "claim_id": "FACT-003",
            "category": "SECURITY",
            "approved_statement": "SOC2 Type II and ISO 27001 certified",
            "allowed_metrics": ["SOC2 Type II", "ISO 27001"],
            "source_citation": "Compliance Registry — External Audit Letters 2026",
            "expires_at": "2027-06-30",
        },
        {
            "claim_id": "FACT-004",
            "category": "COVERAGE",
            "approved_statement": "Payments supported in 42 currencies; settlement speeds vary by corridor",
            "allowed_metrics": ["42 currencies"],
            "source_citation": "Corridor Coverage Matrix v3.1",
            "expires_at": "2027-01-31",
        },
        {
            "claim_id": "FACT-005",
            "category": "PRICING",
            "approved_statement": "Published pricing starts at 0.4% per domestic transaction, with volume tiers available",
            "allowed_metrics": ["0.4%", "volume tiers"],
            "source_citation": "Public Pricing Schedule, effective 2026-07-01",
            "expires_at": "2026-12-31",
        },
    ],
}


# -----------------------------------------------------------------------------
# IN-MEMORY MANIFEST CACHE (zero network I/O on the hot path)
# -----------------------------------------------------------------------------
MANIFEST_CACHE: dict[str, dict] = {}


def set_cached_manifest(brand_id: str, manifest: dict) -> dict:
    """Validate against BrandManifest, then store a plain dict for fastest reads."""
    validated = BrandManifest.model_validate(manifest).model_dump()
    MANIFEST_CACHE[brand_id] = validated
    return validated


def get_cached_manifest(brand_id: str) -> dict | None:
    """O(1) read. Returned dict is shared — treat as READ-ONLY (use deepcopy to mutate)."""
    return MANIFEST_CACHE.get(brand_id)


def invalidate_manifest(brand_id: str) -> None:
    MANIFEST_CACHE.pop(brand_id, None)


def clone_manifest(brand_id: str) -> dict | None:
    """Mutable deep copy (e.g. for accept-pr merges before set_cached_manifest)."""
    cached = MANIFEST_CACHE.get(brand_id)
    return copy.deepcopy(cached) if cached is not None else None


def seed_manifest_cache() -> None:
    set_cached_manifest(DEFAULT_BRAND_MANIFEST["brand_id"], DEFAULT_BRAND_MANIFEST)


seed_manifest_cache()
