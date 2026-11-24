import { Zap, FileUp, Bell, Globe, ChevronDown, Lock, HelpCircle } from "lucide-react";
import { ROLES, STATUS_STYLES } from "../lib.js";

export default function TopNavBar({
  brands,
  activeBrandId,
  onSelectBrand,
  preflightMs,
  score,
  status,
  role,
  onRole,
  online,
  onRetry,
  onOpenPdfModal,
  onOpenWebhookModal,
  onOpenLinterModal,
  onOpenTour,
  webhookCount,
  isSessionLocked,
  highlightTour = false,
}) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.DRAFT;
  const scoreColor =
    score === null
      ? "text-slate-400"
      : score >= 85
      ? "text-emerald-400"
      : score >= 60
      ? "text-amber-400"
      : "text-red-400";

  return (
    <header
      className={`h-14 shrink-0 border-b border-slate-800/90 bg-[#090D16]/95 backdrop-blur px-4 lg:px-5 flex items-center justify-between gap-3 select-none transition-shadow ${
        highlightTour ? "ring-2 ring-inset ring-indigo-500/70" : ""
      }`}
    >
      {/* Left: Brand Logo, Brand Switcher & Round 3 Quick Actions */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img src="/logo.svg" alt="Bastion" className="h-6 w-6" />
          <span className="text-[15px] font-semibold tracking-tight text-slate-100">
            Bastion
          </span>
        </div>

        <span className="text-slate-700">/</span>

        <div className="relative flex items-center">
          <select
            value={activeBrandId}
            onChange={(e) => onSelectBrand(e.target.value)}
            aria-label="Select brand manifest"
            className="appearance-none bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-lg pl-2.5 pr-7 py-1 text-xs font-medium text-slate-200 focus:outline-none cursor-pointer transition-colors"
          >
            {brands.map((b) => (
              <option key={b.brand_id} value={b.brand_id} className="bg-slate-900 text-slate-100">
                {b.brand_name} (v{b.version})
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2" />
        </div>

        <button
          onClick={onOpenPdfModal}
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/70 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
          title="Upload a PDF brand book to compile a new BrandManifest via RAG"
        >
          <FileUp className="w-3.5 h-3.5 text-indigo-400" />
          <span>Ingest PDF</span>
        </button>

        <button
          onClick={onOpenLinterModal}
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/70 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
          title="Open the live Chrome Extension content linter sandbox"
        >
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          <span>Web Linter</span>
        </button>
      </div>

      {/* Center: Compact Telemetry */}
      <div className="hidden xl:flex items-center gap-3 text-xs font-mono text-slate-400">
        <span className="inline-flex items-center gap-1.5" title="Deterministic pre-flight latency">
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-200">
            {preflightMs !== null ? `${preflightMs.toFixed(1)}ms` : "—"}
          </span>
        </span>

        <span className="text-slate-800">•</span>

        <span className="inline-flex items-center gap-1.5">
          <span>Score</span>
          <span className={`font-semibold ${scoreColor}`}>
            {score !== null ? `${score}/100` : "—"}
          </span>
        </span>

        <span className="text-slate-800">•</span>

        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-sans font-medium ring-1 ring-inset ${st.cls}`}>
          {st.label}
        </span>

        {isSessionLocked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full">
            <Lock className="w-3 h-3" />
            Locked
          </span>
        )}
      </div>

      {/* Right: Guide, Webhooks Bell, Status Dot & Single Role Dropdown */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenTour}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-900/70 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
          title="Open quick walkthrough"
        >
          <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Guide</span>
        </button>

        <button
          onClick={onOpenWebhookModal}
          className="relative p-1.5 rounded-lg text-slate-400 hover:text-slate-100 bg-slate-900/70 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
          title="Slack/Teams Webhooks & Governance Event Stream"
        >
          <Bell className="w-4 h-4" />
          {webhookCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-[10px] font-mono text-white flex items-center justify-center">
              {webhookCount}
            </span>
          )}
        </button>

        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-slate-900 transition-colors cursor-pointer"
          title={online ? "Connected to FastAPI backend. Click to refresh." : "Running local deterministic engine. Click to reconnect."}
        >
          <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`} />
        </button>

        <div className="relative flex items-center">
          <select
            value={role}
            onChange={(e) => onRole(e.target.value)}
            aria-label="Active reviewer role"
            className="appearance-none bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/40 text-indigo-200 rounded-lg pl-3 pr-7 py-1 text-xs font-medium focus:outline-none cursor-pointer transition-colors"
          >
            {ROLES.map((r) => (
              <option key={r} value={r} className="bg-slate-900 text-slate-100">
                {r}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-indigo-300 pointer-events-none absolute right-2" />
        </div>
      </div>
    </header>
  );
}
