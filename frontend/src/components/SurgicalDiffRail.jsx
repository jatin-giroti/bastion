import { useState } from "react";
import { Check, Lock, Rocket, ShieldCheck, Undo2, Loader2 } from "lucide-react";
import { CATEGORY_LABEL, OVERRIDE_THRESHOLD, SEVERITY, STATUS_STYLES, canOverride, canPublish, overrideHint } from "../lib.js";

function Diff({ flag }) {
  return (
    <div className="mt-3 rounded-lg border border-bastion-line bg-bastion-bg p-3 font-mono text-xs leading-relaxed">
      <del className="diff-del break-words">{flag.exact_quote}</del>
      <span className="mx-1.5 text-bastion-muted">becomes</span>
      <ins className="diff-ins break-words">{flag.surgical_fix}</ins>
    </div>
  );
}

function OverrideProgress({ count }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: OVERRIDE_THRESHOLD }).map((_, i) => (
        <span key={i} className={`h-1.5 w-6 rounded-full ${i < count ? "bg-bastion-accent" : "bg-bastion-line"}`} />
      ))}
    </div>
  );
}

function FlagCard({ flag, role, overrideCount, onAccept, onOverride, onHover }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sev = SEVERITY[flag.severity] || SEVERITY.LOW;
  const resolved = flag.status !== "OPEN";
  const allowed = canOverride(role, flag);
  const hint = overrideHint(role, flag);
  const reasonOk = reason.trim().length >= 8;

  const submit = async () => {
    setBusy(true);
    const ok = await onOverride(flag, reason.trim());
    setBusy(false);
    if (ok) { setOpen(false); setReason(""); }
  };

  return (
    <li
      onMouseEnter={() => onHover(flag.flag_id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(flag.flag_id)} onBlur={() => onHover(null)}
      className={`rounded-xl border bg-bastion-surface p-4 ${resolved ? "border-bastion-line opacity-60" : "border-bastion-line"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sev.badge}`}>{sev.label}</span>
        <span className="text-xs text-bastion-muted">{CATEGORY_LABEL[flag.category] || flag.category}</span>
        <span className="ml-auto rounded bg-bastion-bg px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ring-bastion-line" title={flag.rule_citation}>{flag.rule_id}</span>
      </div>
      <p className="mt-2 text-xs text-bastion-muted">{flag.rule_citation}</p>
      <Diff flag={flag} />
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{flag.explanation}</p>

      {resolved ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-bastion-muted">
          {flag.status === "ACCEPTED" ? <Check className="h-3.5 w-3.5 text-bastion-ok" /> : <Undo2 className="h-3.5 w-3.5 text-amber-300" />}
          {flag.status === "ACCEPTED" ? "Fix accepted" : "Overridden by a reviewer"}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => onAccept(flag)} className="rounded-md bg-bastion-ok px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-400">
              Accept surgical fix
            </button>
            <button
              onClick={() => setOpen((v) => !v)} disabled={!allowed} title={hint} aria-expanded={open}
              className="rounded-md border border-bastion-line px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Override with reason
            </button>
          </div>
          {!allowed && <p className="mt-2 text-xs text-bastion-muted">{hint}</p>}
          {open && allowed && (
            <div className="mt-3 space-y-2 rounded-lg border border-bastion-line bg-bastion-bg p-3">
              <label className="block text-xs text-bastion-muted" htmlFor={`reason-${flag.flag_id}`}>Why does this copy stay as written?</label>
              <textarea
                id={`reason-${flag.flag_id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="For example: internal event, not customer-facing"
                className="w-full resize-none rounded-md border border-bastion-line bg-bastion-surface px-2.5 py-1.5 text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <OverrideProgress count={overrideCount} />
                  <p className="text-[11px] text-bastion-muted">{overrideCount} of {OVERRIDE_THRESHOLD} overrides of {flag.rule_id} before a guideline PR opens</p>
                </div>
                <button
                  onClick={submit} disabled={!reasonOk || busy}
                  className="flex items-center gap-1.5 rounded-md bg-bastion-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  Confirm override
                </button>
              </div>
              {!reasonOk && reason.length > 0 && <p className="text-[11px] text-amber-300">Add at least 8 characters so the reason is useful later.</p>}
            </div>
          )}
        </>
      )}
    </li>
  );
}

export default function SurgicalDiffRail({
  flags, role, status, score, hasResult, dirty, loading, published, overrideCounts, onAccept, onOverride, onHover, onPublish, onRun,
}) {
  const open = flags.filter((f) => f.status === "OPEN");
  const resolved = flags.filter((f) => f.status !== "OPEN");
  const critical = open.filter((f) => f.severity === "CRITICAL_LEGAL").length;
  const st = STATUS_STYLES[status] || STATUS_STYLES.DRAFT;

  let helper = "";
  let canClick = false;
  if (published) helper = "This draft is published.";
  else if (!hasResult) helper = "Run a review before publishing.";
  else if (dirty) helper = "The draft changed. Run the review again before publishing.";
  else if (status === "LEGAL_HOLD") helper = `Legal hold: ${critical} critical legal flag${critical === 1 ? "" : "s"} must be fixed or overridden by a Legal Reviewer.`;
  else if (status === "NEEDS_REVIEW") helper = `Resolve ${open.length} open flag${open.length === 1 ? "" : "s"} to publish.`;
  else if (!canPublish(role)) helper = "Brand Managers and Legal Reviewers publish approved content.";
  else { helper = "All flags are resolved."; canClick = true; }

  return (
    <aside className="flex min-h-0 flex-col border-t border-bastion-line bg-bastion-bg lg:border-l lg:border-t-0" aria-label="Surgical diffs">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold">Surgical diffs</h2>
          <p className="text-xs text-bastion-muted">{hasResult ? `${open.length} open · ${resolved.length} resolved` : "No review yet"}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${st.cls}`}>{st.label}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!hasResult ? (
          <div className="rounded-xl border border-dashed border-bastion-line p-6 text-center">
            <p className="text-sm text-slate-300">Run a review to see exact quotes and minimal fixes.</p>
            <button onClick={onRun} disabled={loading} className="mt-3 rounded-md bg-bastion-accent px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Run review</button>
          </div>
        ) : flags.length === 0 ? (
          <div className="rounded-xl border border-bastion-ok/30 bg-bastion-ok/5 p-6 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-bastion-ok" />
            <p className="mt-2 text-sm">No flags. This draft matches the brand manifest.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {[...open, ...resolved].map((f) => (
              <FlagCard
                key={f.flag_id} flag={f} role={role} overrideCount={overrideCounts[f.rule_id] || 0}
                onAccept={onAccept} onOverride={onOverride} onHover={onHover}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-bastion-line bg-bastion-bg px-4 py-3">
        <button
          onClick={onPublish} disabled={!canClick || published}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            published ? "bg-bastion-ok/20 text-emerald-300" : canClick ? "bg-bastion-ok text-slate-950 hover:bg-emerald-400" : "cursor-not-allowed bg-bastion-surface text-slate-400"
          }`}
        >
          {published ? <Check className="h-4 w-4" /> : status === "LEGAL_HOLD" ? <Lock className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
          {published ? "Published" : "Publish content"}
        </button>
        <p className="mt-2 text-center text-xs text-bastion-muted" aria-live="polite">{helper}</p>
        {hasResult && score !== null && <span className="sr-only">Compliance score {score}</span>}
      </div>
    </aside>
  );
}
