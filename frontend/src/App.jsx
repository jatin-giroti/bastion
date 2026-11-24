import { useCallback, useEffect, useRef, useState } from "react";
import TopNavBar from "./components/TopNavBar.jsx";
import BrandVaultSidebar from "./components/BrandVaultSidebar.jsx";
import DraftCanvas from "./components/DraftCanvas.jsx";
import SurgicalDiffRail from "./components/SurgicalDiffRail.jsx";
import ReverseGovernanceModal from "./components/ReverseGovernanceModal.jsx";
import PdfIngestModal from "./components/PdfIngestModal.jsx";
import WebLinterModal from "./components/WebLinterModal.jsx";
import WebhookSettingsModal from "./components/WebhookSettingsModal.jsx";
import QuickTourBar from "./components/QuickTourBar.jsx";
import {
  API_URL,
  BRAND_ID,
  OVERRIDE_THRESHOLD,
  api,
  applyFix,
  computeScore,
  deriveStatus,
  normalizeHex,
  sortFlags,
} from "./lib.js";
import {
  FALLBACK_MANIFEST,
  SAMPLE_DRAFTS,
  buildLocalPR,
  localAudit,
  mergeLocalPR,
} from "./mockFallback.js";

const FIRST = SAMPLE_DRAFTS[0];

export default function App() {
  const [manifestsById, setManifestsById] = useState({ [BRAND_ID]: FALLBACK_MANIFEST });
  const [activeBrandId, setActiveBrandId] = useState(BRAND_ID);
  const [ragChunksByBrand, setRagChunksByBrand] = useState({});
  const [online, setOnline] = useState(null);
  const onlineRef = useRef(null);

  const [role, setRole] = useState("Creator");
  const [presetId, setPresetId] = useState(FIRST.id);
  const [draft, setDraft] = useState(FIRST.text);
  const [fg, setFg] = useState(FIRST.fg);
  const [bg, setBg] = useState(FIRST.bg);
  const [hasAlt, setHasAlt] = useState(FIRST.hasAlt);
  const [altText, setAltText] = useState(FIRST.altText);
  const [imageB64, setImageB64] = useState(null);
  const [imageName, setImageName] = useState("");

  const [result, setResult] = useState(null);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState(false);
  const [activeFlagId, setActiveFlagId] = useState(null);

  const [overrideCounts, setOverrideCounts] = useState({});
  const overrideLog = useRef({});
  const [pr, setPr] = useState(null);
  const [prBusy, setPrBusy] = useState(false);

  // Round 3 Modals & Webhook State
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [linterModalOpen, setLinterModalOpen] = useState(false);
  const [webhookModalOpen, setWebhookModalOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(() => {
    try {
      return localStorage.getItem("bastion.webhookUrl") || "";
    } catch {
      return "";
    }
  });
  const [eventLogs, setEventLogs] = useState([]);

  const [tourOpen, setTourOpen] = useState(() => {
    try {
      return localStorage.getItem("bastion_tour_seen") !== "1";
    } catch {
      return true;
    }
  });
  const [tourStep, setTourStep] = useState(0);
  const reviewInFlight = useRef(false);
  const acceptInFlight = useRef(new Set());
  const overrideInFlight = useRef(false);

  const closeTour = () => {
    setTourOpen(false);
    try {
      localStorage.setItem("bastion_tour_seen", "1");
    } catch {
      /* ignore */
    }
  };

  const [toast, setToast] = useState(null);
  const altRef = useRef(null);
  const toastTimer = useRef(null);

  const manifest = manifestsById[activeBrandId] || FALLBACK_MANIFEST;
  const brands = Object.values(manifestsById);

  const notify = useCallback((message, tone = "info") => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  const logEvent = useCallback((typeOrEvent, message) => {
    const entry =
      typeOrEvent && typeof typeOrEvent === "object"
        ? {
            id: typeOrEvent.id || `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            type: typeOrEvent.type || "EVENT",
            message: typeOrEvent.message || "",
            at: typeOrEvent.at || new Date().toISOString(),
            ...(typeof typeOrEvent.delivered === "boolean" ? { delivered: typeOrEvent.delivered } : {}),
          }
        : {
            id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            type: String(typeOrEvent || "EVENT"),
            message: String(message || ""),
            at: new Date().toISOString(),
          };
    setEventLogs((prev) => [...prev, entry].slice(-50));
  }, []);

  const setConnection = (value) => {
    onlineRef.current = value;
    setOnline(value);
  };

  const checkConnection = useCallback(async (brandId = BRAND_ID) => {
    try {
      const m = await api("GET", `/api/v1/manifest/${brandId}`, undefined, 8000);
      setManifestsById((prev) => ({ ...prev, [m.brand_id]: m }));
      if (Array.isArray(m.rag_chunks) && m.rag_chunks.length > 0) {
        setRagChunksByBrand((prev) => ({ ...prev, [m.brand_id]: m.rag_chunks }));
      }
      setConnection(true);
      return { online: true, manifest: m };
    } catch {
      setConnection(false);
      return { online: false, manifest: null };
    }
  }, []);

  const runReview = useCallback(
    async (input, manifestOverride) => {
      if (reviewInFlight.current || !input?.draft?.trim()) return;
      reviewInFlight.current = true;
      const m = manifestOverride || manifest;
      setLoading(true);
      setPublished(false);
      let res = null;
      if (onlineRef.current !== false) {
        try {
          res = await api("POST", `/api/v1/review/${m.brand_id}`, {
            brand_id: m.brand_id,
            draft_text: input.draft,
            fg_hex: input.fg,
            bg_hex: input.bg,
            has_alt_text: input.hasAlt,
            alt_text: input.altText,
            image_b64: input.imageB64 || null,
            creator_role: role,
          });
          setConnection(true);
        } catch (err) {
          if (err.status) notify(`Review failed: ${err.message}. Using local engine.`, "warn");
          else setConnection(false);
        }
      }
      if (!res) res = localAudit({ ...input, manifest: m, hasImage: !!input.imageB64 });
      setResult(res);
      setFlags(sortFlags(res.flags, input.draft));
      setDirty(false);
      setLoading(false);
      reviewInFlight.current = false;

      if (res.status === "LEGAL_HOLD") {
        logEvent("LEGAL_HOLD", `${m.brand_name}: Draft blocked on LEGAL_HOLD (Score ${res.compliance_score}/100).`);
      }
    },
    [manifest, role, notify, logEvent]
  );

  const currentInput = () => ({ draft, fg, bg, hasAlt, altText, imageB64 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const conn = await checkConnection(BRAND_ID);
      if (cancelled) return;
      await runReview(
        { draft: FIRST.text, fg: FIRST.fg, bg: FIRST.bg, hasAlt: FIRST.hasAlt, altText: FIRST.altText, imageB64: null },
        conn.manifest || FALLBACK_MANIFEST
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (setter) => (value) => {
    setter(value);
    setDirty(true);
    setPublished(false);
  };

  const loadPreset = (p) => {
    setPresetId(p.id);
    setDraft(p.text);
    setFg(p.fg);
    setBg(p.bg);
    setHasAlt(p.hasAlt);
    setAltText(p.altText);
    setImageB64(null);
    setImageName("");
    runReview({ draft: p.text, fg: p.fg, bg: p.bg, hasAlt: p.hasAlt, altText: p.altText, imageB64: null });
  };

  const handleSelectBrand = (brandId) => {
    setActiveBrandId(brandId);
    const nextManifest = manifestsById[brandId] || FALLBACK_MANIFEST;
    runReview(currentInput(), nextManifest);
    notify(`Switched manifest to ${nextManifest.brand_name} v${nextManifest.version}.`);
  };

  const handleManifestIngested = (newManifest, ragChunks) => {
    setManifestsById((prev) => ({ ...prev, [newManifest.brand_id]: newManifest }));
    setRagChunksByBrand((prev) => ({ ...prev, [newManifest.brand_id]: ragChunks || [] }));
    setActiveBrandId(newManifest.brand_id);
    logEvent("PDF_INGESTED", `Compiled ${newManifest.brand_name} v${newManifest.version} (${(ragChunks || []).length} RAG chunks).`);
    runReview(currentInput(), newManifest);
    notify(`Compiled ${newManifest.brand_name} BrandManifest from PDF.`);
  };

  const onImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      notify("Choose an image under 6 MB.", "warn");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageB64(String(reader.result));
      setImageName(file.name);
      setDirty(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const markFlag = (flagId, status) =>
    setFlags((prev) => prev.map((f) => (f.flag_id === flagId ? { ...f, status } : f)));

  const persistAccept = (flag) => {
    if (onlineRef.current && result && !result.submission_id.startsWith("local_")) {
      api("POST", `/api/v1/flags/${result.submission_id}/accept`, { flag_id: flag.flag_id }, 15000).catch(() => {});
    }
  };

  const acceptFix = (flag) => {
    if (!flag || flag.status !== "OPEN" || acceptInFlight.current.has(flag.flag_id)) return;
    acceptInFlight.current.add(flag.flag_id);
    setTimeout(() => acceptInFlight.current.delete(flag.flag_id), 600);
    const lastHex = (flag.surgical_fix.match(/#[0-9a-fA-F]{6}/g) || []).slice(-1)[0];
    if (flag.category === "ACCESSIBILITY") {
      if (flag.rule_id === "WCAG-01" && lastHex) {
        setFg(lastHex.toUpperCase());
      } else if (flag.rule_id === "PALETTE-01" && lastHex) {
        const q = normalizeHex(flag.exact_quote);
        if (q && q === normalizeHex(fg)) setFg(lastHex.toUpperCase());
        else if (q && q === normalizeHex(bg)) setBg(lastHex.toUpperCase());
        else {
          notify("Re-export the banner image with palette colors, then re-run audit.", "warn");
          return;
        }
      } else {
        setHasAlt(true);
        altRef.current?.focus();
        notify("Add descriptive alt text, then re-run audit.", "warn");
        return;
      }
      setPublished(false);
    } else {
      setDraft((d) => applyFix(d, flag));
      setPublished(false);
    }
    markFlag(flag.flag_id, "ACCEPTED");
    persistAccept(flag);
    notify("Surgical fix applied.");
  };

  const overrideFlag = async (flag, reason) => {
    if (overrideInFlight.current || !flag || flag.status !== "OPEN") return false;
    overrideInFlight.current = true;
    try {
    let info = null;
    if (onlineRef.current && result && !result.submission_id.startsWith("local_")) {
      try {
        info = await api(
          "POST",
          `/api/v1/flags/${result.submission_id}/override`,
          { flag_id: flag.flag_id, rule_id: flag.rule_id, reviewer_role: role, reason },
          30000
        );
      } catch (err) {
        if (err.status) {
          notify(err.message, "warn");
          return false;
        }
        setConnection(false);
      }
    }
    if (!info) {
      const log = (overrideLog.current[flag.rule_id] ||= []);
      log.push(reason);
      const count = log.length;
      const created = count === OVERRIDE_THRESHOLD;
      info = {
        override_count: count,
        pr_created: created,
        guideline_pr: created ? buildLocalPR(flag.rule_id, log, manifest, count) : null,
      };
    }
    markFlag(flag.flag_id, "OVERRIDDEN");
    setOverrideCounts((c) => ({ ...c, [flag.rule_id]: info.override_count }));
    setPublished(false);
    if (info.pr_created && info.guideline_pr) {
      setPr(info.guideline_pr);
      logEvent("GUIDELINE_PR_OPENED", `Rule ${flag.rule_id} overridden 3x — Guideline PR ${info.guideline_pr.pr_id} opened.`);
    } else {
      notify(`Override recorded for ${flag.rule_id} (${info.override_count}/${OVERRIDE_THRESHOLD}).`);
    }
    return true;
    } finally {
      overrideInFlight.current = false;
    }
  };

  const acceptPr = async () => {
    if (!pr) return;
    setPrBusy(true);
    try {
      let merged = null;
      if (onlineRef.current && !pr.generated_by?.startsWith("offline")) {
        try {
          const data = await api(
            "POST",
            `/api/v1/manifest/${manifest.brand_id}/accept-pr`,
            { pr_id: pr.pr_id, reviewer_role: role },
            30000
          );
          merged = data.manifest;
        } catch (err) {
          if (err.status) {
            notify(err.message, "warn");
            return;
          }
          setConnection(false);
        }
      }
      if (!merged) merged = mergeLocalPR(manifest, pr);
      setManifestsById((prev) => ({ ...prev, [merged.brand_id]: merged }));
      overrideLog.current[pr.rule_id] = [];
      setOverrideCounts((c) => ({ ...c, [pr.rule_id]: 0 }));
      logEvent("MANIFEST_UPDATED", `Merged ${pr.pr_id} into ${merged.brand_name} v${merged.version}.`);
      notify(`BrandManifest v${merged.version} published.`);
      setPr(null);
    } finally {
      setPrBusy(false);
    }
  };

  const reviewed = !!result;
  const status = deriveStatus(flags, reviewed);
  const score = reviewed ? computeScore(flags) : null;
  const isSessionLocked = status === "LEGAL_HOLD" && role === "Creator";

  return (
    <div className="flex min-h-screen flex-col bg-[#090D16] text-slate-100 lg:h-screen lg:overflow-hidden">
      <TopNavBar
        brands={brands}
        activeBrandId={activeBrandId}
        onSelectBrand={handleSelectBrand}
        preflightMs={result ? result.preflight_latency_ms : null}
        score={score}
        status={status}
        role={role}
        onRole={setRole}
        online={online}
        onRetry={() => checkConnection(activeBrandId)}
        onOpenPdfModal={() => setPdfModalOpen(true)}
        onOpenWebhookModal={() => setWebhookModalOpen(true)}
        onOpenLinterModal={() => setLinterModalOpen(true)}
        webhookCount={eventLogs.length}
        isSessionLocked={isSessionLocked}
        onOpenTour={() => {
          setTourStep(0);
          setTourOpen(true);
        }}
        highlightTour={tourOpen && tourStep === 3}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[276px_minmax(0,1fr)_376px]">
        <div className={`flex min-h-0 flex-col transition-shadow ${tourOpen && tourStep === 0 ? "ring-2 ring-inset ring-indigo-500/70" : ""}`}>
          <BrandVaultSidebar
            manifest={manifest}
            ragChunks={ragChunksByBrand[activeBrandId] || []}
          />
        </div>

        <div className={`flex min-h-0 flex-col transition-shadow ${tourOpen && tourStep === 1 ? "ring-2 ring-inset ring-indigo-500/70" : ""}`}>
        <DraftCanvas
          presets={SAMPLE_DRAFTS}
          activePreset={presetId}
          onPreset={loadPreset}
          draft={draft}
          onDraft={edit(setDraft)}
          flags={flags}
          activeFlagId={activeFlagId}
          fg={fg}
          bg={bg}
          onFg={edit(setFg)}
          onBg={edit(setBg)}
          hasAlt={hasAlt}
          onHasAlt={edit(setHasAlt)}
          altText={altText}
          onAltText={edit(setAltText)}
          altRef={altRef}
          imageName={imageName}
          onImage={onImage}
          onClearImage={() => {
            setImageB64(null);
            setImageName("");
            setDirty(true);
          }}
          palette={manifest.approved_hex_palette}
          minRatio={manifest.wcag_min_ratio}
          onRun={() => runReview(currentInput())}
          loading={loading}
          dirty={dirty}
          hasResult={reviewed}
          isSessionLocked={isSessionLocked}
        />
        </div>

        <div className={`flex min-h-0 flex-col transition-shadow ${tourOpen && tourStep === 2 ? "ring-2 ring-inset ring-indigo-500/70" : ""}`}>
        <SurgicalDiffRail
          flags={flags}
          role={role}
          status={status}
          hasResult={reviewed}
          dirty={dirty}
          loading={loading}
          published={published}
          overrideCounts={overrideCounts}
          onAccept={acceptFix}
          onOverride={overrideFlag}
          onHover={setActiveFlagId}
          onPublish={() => {
            setPublished(true);
            logEvent("PUBLISHED", `Content approved & published by ${role} (Score ${score}/100).`);
            notify("Published.");
          }}
          onRun={() => runReview(currentInput())}
        />
        </div>
      </main>

      <ReverseGovernanceModal
        pr={pr}
        role={role}
        busy={prBusy}
        onAccept={acceptPr}
        onClose={() => setPr(null)}
      />

      <PdfIngestModal
        isOpen={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        apiUrl={API_URL}
        onManifestIngested={handleManifestIngested}
      />

      <WebLinterModal
        isOpen={linterModalOpen}
        onClose={() => setLinterModalOpen(false)}
        manifest={manifest}
      />

      <WebhookSettingsModal
        isOpen={webhookModalOpen}
        onClose={() => setWebhookModalOpen(false)}
        apiUrl={API_URL}
        activeBrandId={activeBrandId}
        webhookUrl={webhookUrl}
        setWebhookUrl={setWebhookUrl}
        eventLogs={eventLogs}
        onLogEvent={logEvent}
      />

      <QuickTourBar
        open={tourOpen}
        step={tourStep}
        onStep={setTourStep}
        onClose={closeTour}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border px-4 py-2 text-xs font-medium shadow-2xl ${
            toast.tone === "warn"
              ? "border-amber-500/40 bg-slate-900 text-amber-200"
              : "border-slate-700 bg-slate-900 text-slate-100"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
