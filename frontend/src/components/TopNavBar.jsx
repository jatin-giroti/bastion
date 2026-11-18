import { Zap, Wifi, WifiOff, Loader2 } from "lucide-react";
import { ROLES, STATUS_STYLES } from "../lib.js";

function ScoreGauge({ score }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const has = score !== null;
  const pct = has ? score / 100 : 0;
  const color = !has ? "#334155" : score >= 85 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex items-center gap-3" role="img" aria-label={has ? `Compliance score ${score} out of 100` : "No compliance score yet"}>
      <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#334155" strokeWidth="4" />
        <circle
          cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 500ms ease, stroke 300ms ease" }}
        />
      </svg>
      <div className="-ml-[60px] flex h-12 w-12 items-center justify-center font-mono text-sm font-medium text-bastion-text">
        {has ? score : "–"}
      </div>
      <div className="leading-tight">
        <div className="text-sm font-medium">Compliance score</div>
        <div className="text-xs text-bastion-muted">Open flags only</div>
      </div>
    </div>
  );
}

export default function TopNavBar({ preflightMs, totalMs, score, status, role, onRole, online, onRetry, triadMode, loading }) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.DRAFT;
  const within = preflightMs !== null && preflightMs < 10;
  const triadLabel = triadMode === "claude-live" ? "Claude triad live" : triadMode === "mixed" ? "Claude triad partial" : triadMode ? "Rules fallback" : "Triad idle";
  return (
    <header className="border-b border-bastion-line bg-bastion-bg/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          <div className="text-[15px] font-semibold leading-tight tracking-tight">bastion</div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-bastion-line bg-bastion-surface px-3 py-1.5" title="Deterministic regex, hex and WCAG checks. No LLM call.">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-bastion-muted" /> : <Zap className={`h-4 w-4 ${within ? "text-bastion-ok" : "text-bastion-muted"}`} />}
          <span className="text-sm text-bastion-muted">Pre-flight</span>
          <span className="font-mono text-sm">{preflightMs === null ? "—" : `${preflightMs.toFixed(1)} ms`}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] ${within ? "bg-bastion-ok/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>under 10 ms</span>
          {totalMs !== null && <span className="hidden font-mono text-xs text-bastion-muted xl:inline">· {Math.round(totalMs)} ms total</span>}
        </div>

        <ScoreGauge score={score} />

        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${st.cls}`} aria-live="polite">{st.label}</span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-bastion-muted hover:bg-bastion-surface hover:text-bastion-text"
            title={online ? "Connected to the Bastion API. Click to re-check." : "API unreachable: running the offline demo engine. Click to retry."}
          >
            {online ? <Wifi className="h-3.5 w-3.5 text-bastion-ok" /> : <WifiOff className="h-3.5 w-3.5 text-bastion-amber" />}
            {online === null ? "Connecting" : online ? triadLabel : "Offline demo"}
          </button>
          <div role="radiogroup" aria-label="Reviewer role" className="flex rounded-lg border border-bastion-line bg-bastion-surface p-0.5">
            {ROLES.map((r) => (
              <button
                key={r} role="radio" aria-checked={role === r} onClick={() => onRole(r)}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${role === r ? "bg-bastion-accent text-white" : "text-bastion-muted hover:text-bastion-text"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
