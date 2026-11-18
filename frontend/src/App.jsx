import { useCallback, useEffect, useRef, useState } from "react";
import TopNavBar from "./components/TopNavBar.jsx";
import BrandVaultSidebar from "./components/BrandVaultSidebar.jsx";
import DraftCanvas from "./components/DraftCanvas.jsx";
import SurgicalDiffRail from "./components/SurgicalDiffRail.jsx";
import ReverseGovernanceModal from "./components/ReverseGovernanceModal.jsx";
import {
  BRAND_ID, OVERRIDE_THRESHOLD, api, applyFix, computeScore, deriveStatus, normalizeHex, sortFlags,
} from "./lib.js";
import {
  FALLBACK_MANIFEST, SAMPLE_DRAFTS, buildLocalPR, localAudit, mergeLocalPR,
} from "./mockFallback.js";

const FIRST = SAMPLE_DRAFTS[0];

export default function App() {
  const [manifest, setManifest] = useState(FALLBACK_MANIFEST);
  const [manifestSource, setManifestSource] = useState("fallback");
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
  const [toast, setToast] = useState(null);
  const altRef = useRef(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message, tone = "info") => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const setConnection = (value) => {
    onlineRef.current = value;
    setOnline(value);
  };

  const checkConnection = useCallback(async () => {
    try {
      const m = await api("GET", `/api/v1/manifest/${BRAND_ID}`, undefined, 8000);
      setManifest(m);
      setManifestSource("api");
      setConnection(true);
      return { online: true, manifest: m };
    } catch {
      setConnection(false);
      return { online: false, manifest: null };
    }
  }, []);

  const runReview = useCallback(
    async (input, manifestOverride) => {
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
          if (err.status) notify(`Review failed: ${err.message}. Using the offline engine.`, "warn");
          else setConnection(false);
        }
      }
      if (!res) res = localAudit({ ...input, manifest: m, hasImage: !!input.imageB64 });
      setResult(res);
      setFlags(sortFlags(res.flags, input.draft));
      setDirty(false);
      setLoading(false);
    },
    [manifest, role, notify]
  );

  const currentInput = () => ({ draft, fg, bg, hasAlt, altText, imageB64 });

  // First load: connect, then review the first sample so the screen is never empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const conn = await checkConnection();
      if (cancelled) return;
      await runReview(
        { draft: FIRST.text, fg: FIRST.fg, bg: FIRST.bg, hasAlt: FIRST.hasAlt, altText: FIRST.altText, imageB64: null },
        conn.manifest || FALLBACK_MANIFEST
      );
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (setter) => (value) => {
    setter(value);
    setDirty(true);
    setPublished(false);
  };

  const loadPreset = (p) => {
    setPresetId(p.id);
    setDraft(p.text); setFg(p.fg); setBg(p.bg); setHasAlt(p.hasAlt); setAltText(p.altText);
    setImageB64(null); setImageName("");
    runReview({ draft: p.text, fg: p.fg, bg: p.bg, hasAlt: p.hasAlt, altText: p.altText, imageB64: null });
  };

  const onImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { notify("Choose an image under 6 MB.", "warn"); return; }
    const reader = new FileReader();
    reader.onload = () => { setImageB64(String(reader.result)); setImageName(file.name); setDirty(true); };
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
    const lastHex = (flag.surgical_fix.match(/#[0-9a-fA-F]{6}/g) || []).slice(-1)[0];
    if (flag.category === "ACCESSIBILITY") {
      if (flag.rule_id === "WCAG-01" && lastHex) {
        setFg(lastHex.toUpperCase());
      } else if (flag.rule_id === "PALETTE-01" && lastHex) {
        const q = normalizeHex(flag.exact_quote);
        if (q && q === normalizeHex(fg)) setFg(lastHex.toUpperCase());
        else if (q && q === normalizeHex(bg)) setBg(lastHex.toUpperCase());
        else { notify("Re-export the banner image with palette colors, then run the review again.", "warn"); return; }
      } else {
        setHasAlt(true);
        altRef.current?.focus();
        notify("Describe the banner in the alt text field, then run the review again.", "warn");
        return;
      }
      setPublished(false);
    } else {
      setDraft((d) => applyFix(d, flag));
      setPublished(false);
    }
    markFlag(flag.flag_id, "ACCEPTED");
    persistAccept(flag);
    notify("Surgical fix applied to the draft.");
  };

  // Returns true when the override was recorded.
  const overrideFlag = async (flag, reason) => {
    let info = null;
    if (onlineRef.current && result && !result.submission_id.startsWith("local_")) {
      try {
        info = await api("POST", `/api/v1/flags/${result.submission_id}/override`, {
          flag_id: flag.flag_id, rule_id: flag.rule_id, reviewer_role: role, reason,
        }, 30000);
      } catch (err) {
        if (err.status) { notify(err.message, "warn"); return false; }
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
    if (info.pr_created && info.guideline_pr) setPr(info.guideline_pr);
    else notify(`Override recorded for ${flag.rule_id} (${info.override_count} of ${OVERRIDE_THRESHOLD}).`);
    return true;
  };

  const acceptPr = async () => {
    if (!pr) return;
    setPrBusy(true);
    try {
      let merged = null;
      if (onlineRef.current && !pr.generated_by?.startsWith("offline")) {
        try {
          const data = await api("POST", `/api/v1/manifest/${manifest.brand_id}/accept-pr`, { pr_id: pr.pr_id, reviewer_role: role }, 30000);
          merged = data.manifest;
        } catch (err) {
          if (err.status) { notify(err.message, "warn"); return; }
          setConnection(false);
        }
      }
      if (!merged) merged = mergeLocalPR(manifest, pr);
      setManifest(merged);
      overrideLog.current[pr.rule_id] = [];
      setOverrideCounts((c) => ({ ...c, [pr.rule_id]: 0 }));
      notify(`BrandManifest v${merged.version} published with the ${pr.rule_id} clarification.`);
      setPr(null);
    } finally {
      setPrBusy(false);
    }
  };

  const reviewed = !!result;
  const status = deriveStatus(flags, reviewed);
  const score = reviewed ? computeScore(flags) : null;

  return (
    <div className="flex min-h-screen flex-col bg-bastion-bg text-bastion-text lg:h-screen lg:overflow-hidden">
      <TopNavBar
        preflightMs={result ? result.preflight_latency_ms : null}
        totalMs={result ? result.total_latency_ms : null}
        score={score} status={status} role={role} onRole={setRole}
        online={online} onRetry={checkConnection} triadMode={result?.triad?.mode} loading={loading}
      />
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_400px]">
        <BrandVaultSidebar manifest={manifest} source={manifestSource} />
        <DraftCanvas
          presets={SAMPLE_DRAFTS} activePreset={presetId} onPreset={loadPreset}
          draft={draft} onDraft={edit(setDraft)} flags={flags} activeFlagId={activeFlagId}
          fg={fg} bg={bg} onFg={edit(setFg)} onBg={edit(setBg)}
          hasAlt={hasAlt} onHasAlt={edit(setHasAlt)} altText={altText} onAltText={edit(setAltText)} altRef={altRef}
          imageName={imageName} onImage={onImage} onClearImage={() => { setImageB64(null); setImageName(""); setDirty(true); }}
          palette={manifest.approved_hex_palette} minRatio={manifest.wcag_min_ratio}
          onRun={() => runReview(currentInput())} loading={loading} dirty={dirty} hasResult={reviewed}
        />
        <SurgicalDiffRail
          flags={flags} role={role} status={status} score={score} hasResult={reviewed} dirty={dirty} loading={loading}
          published={published} overrideCounts={overrideCounts}
          onAccept={acceptFix} onOverride={overrideFlag} onHover={setActiveFlagId}
          onPublish={() => { setPublished(true); notify("Published."); }}
          onRun={() => runReview(currentInput())}
        />
      </main>

      <ReverseGovernanceModal pr={pr} role={role} busy={prBusy} onAccept={acceptPr} onClose={() => setPr(null)} />

      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-xl ${toast.tone === "warn" ? "border-bastion-amber/40 bg-slate-900 text-amber-200" : "border-bastion-line bg-bastion-surface text-bastion-text"}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
