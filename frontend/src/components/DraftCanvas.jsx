import { useLayoutEffect, useMemo, useRef } from "react";
import { Loader2, Play, ImagePlus, X, Lock, ArrowLeftRight } from "lucide-react";
import { SEVERITY, contrastRatio, floor2, hexToRgb, wcagLevel } from "../lib.js";

function buildSegments(text, flags) {
  const ranges = [];
  flags
    .filter((f) => f.status === "OPEN" && f.category !== "ACCESSIBILITY" && f.exact_quote)
    .forEach((f) => {
      let from = 0;
      while (true) {
        const i = text.indexOf(f.exact_quote, from);
        if (i === -1) break;
        ranges.push({ start: i, end: i + f.exact_quote.length, sev: f.severity, id: f.flag_id });
        from = i + f.exact_quote.length;
      }
    });
  ranges.sort((a, b) => a.start - b.start || (SEVERITY[a.sev]?.rank ?? 9) - (SEVERITY[b.sev]?.rank ?? 9));
  const segs = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    if (r.start > cursor) segs.push({ text: text.slice(cursor, r.start) });
    segs.push({ text: text.slice(r.start, r.end), sev: r.sev, id: r.id });
    cursor = r.end;
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor) });
  return segs;
}

function ColorPicker({ label, value, onChange, palette }) {
  const valid = !!hexToRgb(value);
  const picker = valid
    ? "#" + hexToRgb(value).map((n) => n.toString(16).padStart(2, "0")).join("")
    : "#000000";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <div className="flex gap-1">
          {palette.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              title={`Use ${hex}`}
              className="h-4 w-4 rounded ring-1 ring-inset ring-white/20 hover:scale-110 transition-transform"
              style={{ background: hex }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={picker}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-8 cursor-pointer rounded-lg border border-slate-800 bg-transparent p-0.5"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={`w-full rounded-lg border bg-slate-950 px-2.5 py-1.5 font-mono text-xs ${
            valid ? "border-slate-800 text-slate-200" : "border-red-500 text-red-300"
          }`}
        />
      </div>
    </div>
  );
}

export default function DraftCanvas({
  presets,
  activePreset,
  onPreset,
  draft,
  onDraft,
  flags,
  activeFlagId,
  fg,
  bg,
  onFg,
  onBg,
  hasAlt,
  onHasAlt,
  altText,
  onAltText,
  altRef,
  imageName,
  onImage,
  onClearImage,
  palette,
  minRatio,
  onRun,
  loading,
  dirty,
  hasResult,
  isSessionLocked,
}) {
  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const segments = useMemo(() => buildSegments(draft, flags), [draft, flags]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 200)}px`;
  }, [draft]);

  const handleScroll = () => {
    if (taRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const raw = contrastRatio(fg, bg);
  const ratio = raw === null ? null : floor2(raw);
  const level = wcagLevel(raw);
  const previewText = (draft.split(/\n|(?<=[.!?])\s/)[0] || "Campaign headline preview").slice(0, 95);
  const validColors = raw !== null;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto bg-[#090D16]" aria-label="Draft workspace">
      <div className="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => onPreset(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                activePreset === p.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {dirty && hasResult && <span className="text-xs text-amber-400">Unsaved edits</span>}
          <button
            onClick={onRun}
            disabled={loading || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span>{loading ? "Auditing..." : "Run Audit"}</span>
          </button>
        </div>
      </div>

      <div className="p-5 lg:p-6 space-y-6 max-w-4xl w-full mx-auto">
        {isSessionLocked && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            <Lock className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              <strong>Session Locked (LEGAL_HOLD):</strong> Direct editing is frozen for Creators while critical legal flags are open. Accept surgical fixes or switch role to <strong>Legal Reviewer</strong>.
            </span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium text-slate-300">Campaign Copy</span>
            <span className="font-mono text-[11px]">{draft.length} chars</span>
          </div>

          <div className="relative rounded-2xl border border-slate-800 bg-slate-900/50 focus-within:border-indigo-500/70 transition-colors">
            <div
              ref={backdropRef}
              aria-hidden="true"
              className="canvas-type pointer-events-none absolute inset-0 overflow-hidden text-transparent"
            >
              {segments.map((s, i) =>
                s.sev ? (
                  <mark
                    key={i}
                    className={`${SEVERITY[s.sev].mark} ${s.id === activeFlagId ? "hl-active" : ""} text-transparent`}
                  >
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                )
              )}
              {"\u200b"}
            </div>

            <textarea
              ref={taRef}
              value={draft}
              readOnly={isSessionLocked}
              onScroll={handleScroll}
              onChange={(e) => onDraft(e.target.value)}
              spellCheck={false}
              rows={7}
              placeholder="Write or paste marketing copy..."
              className="canvas-type relative block w-full resize-none overflow-hidden border-0 bg-transparent text-slate-100 caret-white outline-none placeholder:text-slate-600 focus-visible:outline-none"
            />
          </div>
        </div>

        {/* Visual & WCAG Contrast Proofing */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Visual & WCAG Contrast</span>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-slate-200 font-semibold">
                {ratio === null ? "—" : `${ratio.toFixed(2)}:1`}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  ratio !== null && ratio >= minRatio
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300"
                }`}
              >
                {level === "FAIL" ? `FAIL (<${minRatio}:1)` : `WCAG ${level}`}
              </span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <div
              className="flex flex-col justify-between min-h-[156px] rounded-xl p-5 ring-1 ring-inset ring-white/10 transition-colors"
              style={{
                background: validColors ? bg : "#1E293B",
                color: validColors ? fg : "#94A3B8",
              }}
            >
              <div className="flex items-center justify-between text-[10px] font-mono opacity-75">
                <span>BANNER PREVIEW</span>
                <span>{fg} / {bg}</span>
              </div>
              <p className="text-base font-semibold leading-snug tracking-tight my-3">
                {previewText}
              </p>
              <div className="text-[10px] font-mono opacity-75 truncate">
                Alt: {hasAlt && altText ? altText : "[missing]"}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2.5">
                <ColorPicker label="Text Color" value={fg} onChange={onFg} palette={palette} />
                <ColorPicker label="Background" value={bg} onChange={onBg} palette={palette} />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const prevFg = fg;
                    onFg(bg);
                    onBg(prevFg);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>Swap Colors</span>
                </button>

                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white">
                    <ImagePlus className="h-3 w-3" />
                    <span>{imageName ? "Change Image" : "Upload Banner"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={onImage}
                    />
                  </label>
                  {imageName && (
                    <button
                      type="button"
                      onClick={onClearImage}
                      aria-label="Remove image"
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasAlt}
                    onChange={(e) => onHasAlt(e.target.checked)}
                    className="h-3.5 w-3.5 accent-indigo-500 rounded"
                  />
                  <span>Include screen-reader alt text</span>
                </label>
                <input
                  ref={altRef}
                  value={altText}
                  onChange={(e) => onAltText(e.target.value)}
                  disabled={!hasAlt}
                  placeholder="Describe the visual asset..."
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
