import { useEffect } from "react";
import { GitPullRequest, X, Loader2 } from "lucide-react";
import { canAcceptPR } from "../lib.js";

export default function ReverseGovernanceModal({ pr, role, busy, onAccept, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!pr) return null;
  const allowed = canAcceptPR(role);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="pr-title" className="modal-rise max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-bastion-line bg-bastion-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-bastion-line p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-bastion-accent/20 p-2 text-indigo-300"><GitPullRequest className="h-5 w-5" /></div>
            <div>
              <h2 id="pr-title" className="text-base font-semibold">Guideline pull request for {pr.rule_id}</h2>
              <p className="mt-0.5 text-sm text-bastion-muted">
                Reviewers overrode this rule {pr.override_count} times. Bastion drafted a clarification so the rule stops needing manual overrides.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-bastion-muted hover:text-bastion-text"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="mb-2 text-sm font-medium">What reviewers said</h3>
            <ul className="space-y-1.5">
              {pr.sample_reasons.map((r, i) => (
                <li key={i} className="rounded-md border border-bastion-line bg-bastion-bg px-3 py-2 text-sm text-slate-300">“{r}”</li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">Current rule</h3>
              <p className="rounded-lg border border-bastion-danger/30 bg-bastion-danger/5 p-3 text-sm leading-relaxed text-slate-300">{pr.original_rule_text}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Proposed rule</h3>
              <p className="rounded-lg border border-bastion-ok/30 bg-bastion-ok/5 p-3 text-sm leading-relaxed text-slate-200">
                {pr.original_rule_text} <ins className="diff-ins">{pr.clarification}</ins>
              </p>
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 text-sm font-medium">Why this change</h3>
            <p className="text-sm leading-relaxed text-slate-300">{pr.rationale}</p>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bastion-line p-5">
          <p className="max-w-sm text-xs text-bastion-muted">
            {allowed ? "Accepting merges this into the BrandManifest, bumps its version and refreshes the cache." : "Switch to Brand Manager or Legal Reviewer to accept this change."}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-bastion-line px-3.5 py-2 text-sm text-slate-200 hover:border-slate-500">Not now</button>
            <button
              onClick={onAccept} disabled={!allowed || busy}
              className="flex items-center gap-1.5 rounded-md bg-bastion-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Accept guideline update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
