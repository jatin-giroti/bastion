import { useLayoutEffect, useMemo, useRef } from "react";
import { Loader2, Play, ImagePlus, X } from "lucide-react";
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

function ColorField({ label, value, onChange, palette }) {
  const valid = !!hexToRgb(value);
  const picker = valid ? "#" + hexToRgb(value).map((n) => n.toString(16).padStart(2, "0")).join("") : "#000000";
  return (
    <div>
      <label className="mb-1.5 block text-xs text-bastion-muted">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={picker} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-9 cursor-pointer rounded-md border border-bastion-line bg-transparent p-0.5" aria-label={`${label} color picker`}
        />
        <input
          value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={`${label} hex value`}
          className={`w-28 rounded-md border bg-bastion-bg px-2.5 py-1.5 font-mono text-sm ${valid ? "border-bastion-line" : "border-bastion-danger"}`}
        />
        <div className="flex gap-1">
          {palette.map((hex) => (
            <button key={hex} onClick={() => onChange(hex)} title={`Use ${hex}`} aria-label={`Use ${hex}`}
              className="h-6 w-6 rounded ring-1 ring-inset ring-white/20 hover:scale-110" style={{ background: hex }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DraftCanvas({
  presets, activePreset, onPreset, draft, onDraft, flags, activeFlagId,
  fg, bg, onFg, onBg, hasAlt, onHasAlt, altText, onAltText, altRef,
  imageName, onImage, onClearImage, palette, minRatio, onRun, loading, dirty, hasResult,
}) {
  const taRef = useRef(null);
  const segments = useMemo(() => buildSegments(draft, flags), [draft, flags]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 220)}px`;
  }, [draft]);

  const raw = contrastRatio(fg, bg);
  const ratio = raw === null ? null : floor2(raw);
  const level = wcagLevel(raw);
  const preset = presets.find((p) => p.id === activePreset);
  const previewText = (draft.split(/\n|(?<=[.!?])\s/)[0] || "Your headline appears here").slice(0, 90);
  const validColors = raw !== null;

  return (
    <section className="flex min-h-0 flex-col overflow-y-auto" aria-label="Draft canvas">
      <div className="border-b border-bastion-line px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-bastion-muted">Sample drafts</span>
          {presets.map((p) => (
            <button
              key={p.id} onClick={() => onPreset(p)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${activePreset === p.id ? "border-bastion-accent bg-bastion-accent/20 text-bastion-text" : "border-bastion-line text-bastion-muted hover:border-slate-500 hover:text-bastion-text"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset && <p className="mt-2 max-w-2xl text-xs leading-relaxed text-bastion-muted">{preset.description}</p>}
      </div>

      <div className="px-4 py-5 lg:px-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Draft copy</h2>
          <div className="flex items-center gap-3">
            {dirty && hasResult && <span className="text-xs text-amber-300">Edited since the last review</span>}
            <button
              onClick={onRun} disabled={loading || !draft.trim()}
              className="flex items-center gap-1.5 rounded-md bg-bastion-accent px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {loading ? "Reviewing" : "Run review"}
            </button>
          </div>
        </div>

        <div className="relative rounded-xl border border-bastion-line bg-bastion-surface focus-within:border-indigo-400">
          <div aria-hidden="true" className="canvas-type pointer-events-none absolute inset-0 text-transparent">
            {segments.map((s, i) =>
              s.sev ? (
                <mark key={i} className={`${SEVERITY[s.sev].mark} ${s.id === activeFlagId ? "hl-active" : ""} text-transparent`}>{s.text}</mark>
              ) : (
                <span key={i}>{s.text}</span>
              )
            )}
            {"\u200b"}
          </div>
          <textarea
            ref={taRef} value={draft} onChange={(e) => onDraft(e.target.value)} spellCheck={false} rows={8}
            aria-label="Draft copy to review" placeholder="Paste marketing copy to review against the brand manifest."
            className="canvas-type relative block w-full resize-none overflow-hidden border-0 bg-transparent text-bastion-text caret-white outline-none placeholder:text-slate-500 focus-visible:outline-none"
          />
        </div>
        <p className="mt-2 text-xs text-bastion-muted">
          Highlights show open flags by severity. Hover a flag in the right rail to find it here.
        </p>
      </div>

      <div className="border-t border-bastion-line px-4 py-5 lg:px-6">
        <h2 className="mb-3 text-sm font-medium">Banner contrast</h2>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <ColorField label="Text color" value={fg} onChange={onFg} palette={palette} />
            <ColorField label="Background color" value={bg} onChange={onBg} palette={palette} />
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasAlt} onChange={(e) => onHasAlt(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
                Banner has alt text
              </label>
              <input
                ref={altRef} value={altText} onChange={(e) => onAltText(e.target.value)} disabled={!hasAlt}
                placeholder="Describe what the banner shows" aria-label="Alt text"
                className="w-full rounded-md border border-bastion-line bg-bastion-bg px-2.5 py-1.5 text-sm disabled:opacity-40"
              />
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-bastion-line px-2.5 py-1.5 text-xs text-bastion-muted hover:text-bastion-text">
                  <ImagePlus className="h-3.5 w-3.5" />
                  Attach banner image
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={onImage} />
                </label>
                {imageName && (
                  <span className="flex items-center gap-1 text-xs text-bastion-muted">
                    {imageName}
                    <button onClick={onClearImage} aria-label="Remove image" className="rounded p-0.5 hover:text-bastion-text"><X className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div
              className="flex min-h-[132px] items-center rounded-xl px-6 py-5 ring-1 ring-inset ring-white/10"
              style={{ background: validColors ? bg : "#1E293B", color: validColors ? fg : "#94A3B8" }}
            >
              <p className="text-xl font-semibold leading-snug tracking-tight">{previewText}</p>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="font-mono text-2xl tabular-nums">{ratio === null ? "—" : ratio.toFixed(2)}<span className="text-sm text-bastion-muted"> : 1</span></div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className={`rounded px-2 py-0.5 ${ratio !== null && ratio >= minRatio ? "bg-bastion-ok/15 text-emerald-300" : "bg-bastion-danger/15 text-red-300"}`}>
                  Body text {ratio !== null && ratio >= minRatio ? "passes" : "fails"} {minRatio}:1
                </span>
                <span className={`rounded px-2 py-0.5 ${level === "AAA" ? "bg-bastion-ok/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>AAA 7:1 {level === "AAA" ? "passes" : "not met"}</span>
                <span className={`rounded px-2 py-0.5 ${ratio !== null && ratio >= 3 ? "bg-bastion-ok/15 text-emerald-300" : "bg-bastion-danger/15 text-red-300"}`}>Large text 3:1 {ratio !== null && ratio >= 3 ? "passes" : "fails"}</span>
              </div>
            </div>
            {!validColors && <p className="mt-2 text-xs text-red-300">Enter colors as #RRGGBB to calculate contrast.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
