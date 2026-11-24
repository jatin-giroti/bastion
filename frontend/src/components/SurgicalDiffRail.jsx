import { useState } from "react";
import { Check, Lock, Rocket, ShieldCheck, Undo2, Loader2 } from "lucide-react";
import {
  CATEGORY_LABEL,
  OVERRIDE_THRESHOLD,
  SEVERITY,
  canOverride,
  canPublish,
  overrideHint,
} from "../lib.js";

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
    if (ok) {
      setOpen(false);
      setReason("");
    }
  };

  return (
    <li
      onMouseEnter={() => onHover(flag.flag_id)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-2xl border p-4 transition-colors ${
        resolved
          ? "border-slate-800/60 bg-slate-900/30 opacity-60"
          : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sev.badge}`}>
            {sev.label}
          </span>
          <span className="text-[11px] text-slate-400">
            {CATEGORY_LABEL[flag.category] || flag.category}
          </span>
        </div>
        <span
          className="rounded-md bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 border border-slate-800"
          title={flag.rule_citation}
        >
          {flag.rule_id}
        </span>
      </div>

      {/* Surgical Diff */}
      <div className="mt-3 rounded-xl border border-slate-800/90 bg-slate-950/90 p-3 font-mono text-xs leading-relaxed">
        <del className="diff-del break-words">{flag.exact_quote}</del>
        <span className="mx-1.5 text-slate-500">→</span>
        <ins className="diff-ins break-words">{flag.surgical_fix}</ins>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-slate-400">{flag.explanation}</p>

      {resolved ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          {flag.status === "ACCEPTED" ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Undo2 className="h-3.5 w-3.5 text-amber-400" />
          )}
          <span>{flag.status === "ACCEPTED" ? "Fix applied" : "Overridden"}</span>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onAccept(flag)}
              className="flex-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors cursor-pointer"
            >
              Accept fix
            </button>
            <button
              onClick={() => setOpen((v) => !v)}
              disabled={!allowed}
              title={hint}
              className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
            >
              Override
            </button>
          </div>
          {!allowed && <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>}

          {open && allowed && (
            <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Reason for override (e.g., approved internal launch hook)"
                className="w-full resize-none rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: OVERRIDE_THRESHOLD }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-5 rounded-full ${
                        i < overrideCount ? "bg-indigo-500" : "bg-slate-800"
                      }`}
                    />
                  ))}
                  <span className="text-[10px] font-mono text-slate-400 ml-1">
                    {overrideCount}/{OVERRIDE_THRESHOLD}
                  </span>
                </div>
                <button
                  onClick={submit}
                  disabled={!reasonOk || busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1 text-xs font-medium text-white"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>Confirm</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export default function SurgicalDiffRail({
  flags,
  role,
  status,
  hasResult,
  dirty,
  loading,
  published,
  overrideCounts,
  onAccept,
  onOverride,
  onHover,
  onPublish,
  onRun,
}) {
  const [filter, setFilter] = useState("ALL");

  const open = flags.filter((f) => f.status === "OPEN");
  const resolved = flags.filter((f) => f.status !== "OPEN");
  const critical = open.filter((f) => f.severity === "CRITICAL_LEGAL").length;

  const visible = [...open, ...resolved].filter((f) => {
    if (filter === "ALL") return true;
    if (filter === "LEGAL") return f.severity === "CRITICAL_LEGAL";
    if (filter === "TONE") return f.category === "TONE" || f.category === "TERMINOLOGY";
    if (filter === "WCAG") return f.category === "ACCESSIBILITY";
    return true;
  });

  let helper = "";
  let canClick = false;
  if (published) helper = "Published and logged to audit stream.";
  else if (!hasResult) helper = "Run an audit before publishing.";
  else if (dirty) helper = "Copy changed — re-run audit before publishing.";
  else if (status === "LEGAL_HOLD")
    helper = `Blocked by ${critical} critical legal flag${critical === 1 ? "" : "s"}.`;
  else if (status === "NEEDS_REVIEW")
    helper = `Resolve ${open.length} open flag${open.length === 1 ? "" : "s"} to publish.`;
  else if (!canPublish(role))
    helper = "Switch to Brand Manager or Legal Reviewer to publish.";
  else {
    helper = "All checks passed.";
    canClick = true;
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-slate-800/90 bg-[#0B101B] lg:border-l lg:border-t-0">
      <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Surgical Diffs
          </h2>
          <span className="font-mono text-[11px] text-slate-400">
            {open.length} open · {resolved.length} done
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-900/90 p-1 border border-slate-800/90 text-[11px]">
          {[
            ["ALL", "All"],
            ["LEGAL", `Legal (${critical})`],
            ["TONE", "Lexicon"],
            ["WCAG", "WCAG"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`rounded-md py-1 font-medium transition-colors ${
                filter === id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {!hasResult ? (
          <div className="rounded-2xl border border-dashed border-slate-800 p-6 text-center space-y-3">
            <p className="text-xs text-slate-400">Run an audit to generate surgical fixes.</p>
            <button
              onClick={onRun}
              disabled={loading}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-xs font-medium text-white"
            >
              Run Audit
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-emerald-400" />
            <p className="mt-2 text-xs text-slate-300">No flags in this view.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((f) => (
              <FlagCard
                key={f.flag_id}
                flag={f}
                role={role}
                overrideCount={overrideCounts[f.rule_id] || 0}
                onAccept={onAccept}
                onOverride={onOverride}
                onHover={onHover}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="p-3.5 border-t border-slate-800/80 bg-[#090D16]/90 space-y-2">
        <button
          onClick={onPublish}
          disabled={!canClick || published}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
            published
              ? "bg-emerald-500/20 text-emerald-300"
              : canClick
              ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 cursor-pointer"
              : "cursor-not-allowed bg-slate-900 text-slate-500 border border-slate-800"
          }`}
        >
          {published ? (
            <Check className="h-4 w-4" />
          ) : status === "LEGAL_HOLD" ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          <span>{published ? "Published" : "Publish Content"}</span>
        </button>
        <p className="text-center text-[11px] text-slate-500">{helper}</p>
      </div>
    </aside>
  );
}
