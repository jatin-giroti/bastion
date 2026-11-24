import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";

/* ============================================================================
   Helpers
   ========================================================================== */

const STORAGE_KEY = "bastion.webhookUrl";
const TEST_TIMEOUT_MS = 20000;

const EVENT_STYLES = {
  LEGAL_HOLD: { label: "Legal hold", dot: "bg-red-400" },
  GUIDELINE_PR_OPENED: { label: "Guideline PR opened", dot: "bg-indigo-400" },
  PUBLISHED: { label: "Published", dot: "bg-emerald-400" },
  TEST_ALERT: { label: "Test alert", dot: "bg-slate-400" },
};

const REASONS = {
  no_webhook_configured: "No webhook URL is set in this form or on the server.",
  https_required: "The webhook URL must start with https://.",
  private_address_blocked: "That address points to a private network, so Bastion will not send to it.",
  unresolvable_host: "That host name could not be resolved.",
  invalid_webhook_url: "The webhook URL is not valid.",
  httpx_not_installed: "The server is missing its HTTP client. Redeploy with the latest requirements.",
  request_failed: "The server could not reach the webhook endpoint.",
  rejected: "The server rejected the request.",
  backend_offline: "The Bastion API is unreachable, so the alert was simulated locally and nothing was delivered.",
};

function humanizeReason(reason, detail) {
  if (detail) return String(detail);
  if (REASONS[reason]) return REASONS[reason];
  const http = /^http_(\d{3})$/.exec(reason || "");
  if (http) return `The webhook endpoint answered with HTTP ${http[1]}.`;
  return "The alert was not delivered.";
}

function detectProvider(raw) {
  const value = (raw || "").trim();
  if (!value) return { state: "empty" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { state: "invalid", message: "Enter a full URL, for example https://hooks.slack.com/services/..." };
  }
  if (url.protocol !== "https:") return { state: "invalid", message: "The webhook URL must start with https://." };
  const host = url.hostname.toLowerCase();
  if (host.endsWith("hooks.slack.com")) return { state: "ok", provider: "Slack" };
  if (host.endsWith("webhook.office.com") || host.endsWith("outlook.office.com")) return { state: "ok", provider: "Microsoft Teams" };
  if (host.endsWith("logic.azure.com") || host.endsWith("powerplatform.com")) return { state: "ok", provider: "Teams Workflows" };
  return { state: "unknown", message: "Unrecognized host. Bastion will send a Slack-style message." };
}

function readStored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStored(value) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): the URL still works for this session */
  }
}

function eventTime(e) {
  const raw = e.at || e.timestamp || e.time || e.created_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function normalizeType(type) {
  return String(type || "").toUpperCase().replace(/[\s-]+/g, "_");
}

/* ============================================================================
   Component
   ========================================================================== */

export default function WebhookSettingsModal({
  isOpen,
  onClose,
  apiUrl,
  activeBrandId,
  webhookUrl,
  setWebhookUrl,
  eventLogs,
  onLogEvent,
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const logs = Array.isArray(eventLogs) ? eventLogs : [];

  // Restore the saved URL the first time the modal opens with an empty value.
  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    if (!webhookUrl) {
      const stored = readStored();
      if (stored) setWebhookUrl?.(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous && previous.focus) previous.focus();
    };
  }, [isOpen, onClose]);

  // Keep the newest event in view.
  useEffect(() => {
    if (isOpen && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [isOpen, logs.length]);

  if (!isOpen) return null;

  const detected = detectProvider(webhookUrl);
  const times = logs.map(eventTime);
  const allTimed = logs.length > 0 && times.every((t) => t !== null);
  const ordered = allTimed ? logs.map((e, i) => ({ e, t: times[i], i })).sort((a, b) => a.t - b.t || a.i - b.i) : logs.map((e, i) => ({ e, t: times[i], i }));

  const onChange = (value) => {
    setWebhookUrl?.(value);
    writeStored(value.trim());
  };

  const sendTest = async () => {
    if (testing) return;
    setTesting(true);
    setResult(null);
    const url = (webhookUrl || "").trim();
    let outcome;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiUrl || ""}/api/v1/webhooks/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_url: url || null, event_type: "test", brand_id: activeBrandId }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        outcome = { mode: "server", sent: data.sent === true, reason: data.reason, provider: data.provider };
      } else if (res.status >= 500 || [404, 405, 408, 429].includes(res.status)) {
        outcome = { mode: "local", sent: false, reason: "backend_offline" };
      } else {
        const body = await res.json().catch(() => ({}));
        outcome = { mode: "server", sent: false, reason: "rejected", detail: typeof body.detail === "string" ? body.detail : undefined };
      }
    } catch {
      outcome = { mode: "local", sent: false, reason: "backend_offline" }; // offline, CORS failure or cold-start timeout
    } finally {
      clearTimeout(timer);
    }

    const message = outcome.sent
      ? `Test alert delivered${outcome.provider ? ` to ${outcome.provider === "slack" ? "Slack" : outcome.provider.startsWith("teams") ? "Microsoft Teams" : outcome.provider}` : ""}.`
      : outcome.mode === "local"
        ? "Test alert simulated locally (backend offline, not delivered)."
        : `Test alert not delivered. ${humanizeReason(outcome.reason, outcome.detail)}`;
    setResult({ ...outcome, message });
    onLogEvent?.({
      id: `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      type: "TEST_ALERT",
      message,
      delivered: outcome.sent,
      at: new Date().toISOString(),
    });
    setTesting(false);
  };

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-title"
        className="modal-rise flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0F172A] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <h2 id="webhook-title" className="text-lg font-semibold tracking-tight text-slate-100">
              Governance alerts
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">Send legal holds and guideline PRs to Slack or Microsoft Teams.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 pb-6 pt-4">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="webhook-url" className="text-sm text-slate-300">
                Webhook URL
              </label>
              {detected.state === "ok" && (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/30">{detected.provider}</span>
              )}
            </div>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl || ""}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded-lg border border-slate-800 bg-[#090D16] px-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
            <p className={`mt-2 text-xs leading-relaxed ${detected.state === "invalid" ? "text-red-300" : detected.state === "unknown" ? "text-amber-300" : "text-slate-500"}`}>
              {detected.message || "Saved in this browser only. Automatic alerts use the SLACK_WEBHOOK_URL set on the server; this URL is used for test alerts."}
            </p>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={sendTest}
                disabled={testing || detected.state === "invalid"}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Test Alert
              </button>
              {result && (
                <span
                  role="status"
                  className={`flex items-start gap-1.5 text-sm ${result.sent ? "text-emerald-300" : result.mode === "local" ? "text-amber-300" : "text-red-300"}`}
                >
                  {result.sent && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{result.message}</span>
                </span>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-medium text-slate-200">Event log</h3>
            <div ref={listRef} className="max-h-64 overflow-y-auto rounded-xl border border-slate-800 bg-[#090D16]" aria-live="polite">
              {ordered.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">
                  No events yet. Legal holds, guideline PRs, publishes and test alerts appear here in order.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {ordered.map(({ e, t, i }) => {
                    const style = EVENT_STYLES[normalizeType(e.type)] || { label: String(e.type || "Event"), dot: "bg-slate-500" };
                    return (
                      <li key={e.id || `${i}-${e.type}`} className="flex items-start gap-3 px-5 py-3.5">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-200">{style.label}</span>
                            <span className="shrink-0 font-mono text-xs text-slate-500">{t !== null ? formatTime(t) : ""}</span>
                          </div>
                          {(e.message || e.detail) && <p className="mt-0.5 break-words text-sm leading-relaxed text-slate-400">{e.message || e.detail}</p>}
                          {typeof e.delivered === "boolean" && (
                            <span className={`mt-1.5 inline-block text-xs ${e.delivered ? "text-emerald-300" : "text-slate-500"}`}>
                              {e.delivered ? "Delivered" : "Not delivered"}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Legal hold and guideline PR events are sent to your webhook. Published events are recorded here only.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
