import { useEffect } from "react";
import { HelpCircle, ChevronLeft, ChevronRight, X } from "lucide-react";

const STEPS = [
  {
    id: "vault",
    title: "1. Brand-as-Code Vault",
    body: "Live rules, prohibited terms, and verified facts driving every audit. Switch tabs to inspect indexed PDF RAG chunks or raw BrandManifest JSON.",
  },
  {
    id: "canvas",
    title: "2. Draft & WCAG Canvas",
    body: "Pick a preset or type copy, then click Run Audit. Inline highlights map directly to policy violations; test banner contrast & alt text below.",
  },
  {
    id: "diffs",
    title: "3. Surgical Diffs & Self-Healing PRs",
    body: "Apply 1-click word-level fixes or override a rule. Three overrides on the same rule automatically draft a Self-Healing Guideline PR.",
  },
  {
    id: "round3",
    title: "4. Round 3 Upgrades (Top Bar)",
    body: "Click Ingest PDF to compile a new brand book, Web Linter for the <10ms browser linter, the Role selector to test LEGAL_HOLD locks, and the Bell icon for Slack/Teams webhooks.",
  },
];

export default function QuickTourBar({ open, step, onStep, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onStep(Math.min(STEPS.length - 1, step + 1));
      else if (e.key === "ArrowLeft") onStep(Math.max(0, step - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onStep, onClose]);

  if (!open) return null;
  const current = STEPS[step] || STEPS[0];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Bastion Quick Walkthrough"
      className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,680px)] -translate-x-1/2 rounded-2xl border border-indigo-500/40 bg-[#0F172A]/95 backdrop-blur-md px-4 py-3 shadow-2xl modal-rise"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 rounded-lg bg-indigo-500/15 p-1.5 text-indigo-400 shrink-0">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-white">{current.title}</h3>
              <span className="font-mono text-[10px] text-slate-400">
                {step + 1}/{STEPS.length}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{current.body}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close guide"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800/80 pt-2.5">
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => onStep(idx)}
              aria-label={`Go to step ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                idx === step ? "w-6 bg-indigo-400" : "w-2 bg-slate-700 hover:bg-slate-500"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200"
          >
            Skip
          </button>
          <button
            onClick={() => onStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            onClick={() => (isLast ? onClose() : onStep(step + 1))}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1 text-[11px] font-semibold text-white cursor-pointer"
          >
            {isLast ? "Done" : "Next"}
            {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
