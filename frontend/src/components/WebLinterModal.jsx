import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, RotateCcw, X } from "lucide-react";
import { localAudit } from "../mockFallback.js";

/* ============================================================================
   Constants & helpers
   ========================================================================== */

const EXTENSION_API_URL = "https://bastion-1693.onrender.com";
const PENALTY = { CRITICAL_LEGAL: 25, MEDIUM: 10, LOW: 3 };
const SEVERITY = {
  CRITICAL_LEGAL: { rank: 0, label: "Critical legal", mark: "hl-critical", badge: "bg-red-500/15 text-red-300 ring-red-500/30" },
  MEDIUM: { rank: 1, label: "Medium", mark: "hl-medium", badge: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  LOW: { rank: 2, label: "Low", mark: "hl-low", badge: "bg-indigo-400/15 text-indigo-300 ring-indigo-400/30" },
};

const SAMPLE_TITLE = "Q4 launch announcement";
const SAMPLE_BODY =
  "We're thrilled to announce that Meridian Pay is the #1 fastest in the world payments platform. Enjoy risk-free returns, leverage our holistic rails, and don't miss out: this limited-time offer ends tonight!";

function lintText(body, manifest) {
  const started = performance.now();
  if (!manifest || !body.trim()) return { flags: [], score: 100, ms: performance.now() - started };
  try {
    const res = localAudit({
      draft: body,
      manifest,
      fg: "#F8FAFC",
      bg: "#0F172A",
      hasAlt: true,
      altText: "Linted page content",
      hasImage: false,
    });
    const flags = res.flags
      .filter((f) => f.category !== "ACCESSIBILITY" && f.status === "OPEN" && body.includes(f.exact_quote))
      .sort((a, b) => {
        const ra = (SEVERITY[a.severity] || { rank: 9 }).rank;
        const rb = (SEVERITY[b.severity] || { rank: 9 }).rank;
        return ra - rb || body.indexOf(a.exact_quote) - body.indexOf(b.exact_quote);
      });
    const penalty = flags.reduce((sum, f) => sum + (PENALTY[f.severity] || 0), 0);
    return { flags, score: Math.max(0, 100 - penalty), ms: performance.now() - started };
  } catch {
    return { flags: [], score: 100, ms: performance.now() - started };
  }
}

function buildSegments(text, flags) {
  const ranges = [];
  for (const f of flags) {
    let from = 0;
    while (true) {
      const i = text.indexOf(f.exact_quote, from);
      if (i === -1) break;
      ranges.push({ start: i, end: i + f.exact_quote.length, sev: f.severity, id: f.flag_id });
      from = i + f.exact_quote.length;
    }
  }
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

function buildManifestJson() {
  return JSON.stringify(
    {
      manifest_version: 3,
      name: "Bastion Web Linter",
      version: "1.0.0",
      description: "Lint copy against your Bastion brand manifest as you type in any CMS or editor.",
      host_permissions: [`${EXTENSION_API_URL}/*`],
      content_scripts: [{ matches: ["https://*/*"], js: ["content.js"], run_at: "document_idle" }],
    },
    null,
    2
  );
}

// Keep this snippet free of backticks and dollar-brace sequences: it is plain ES5 for the extension.
function buildContentJs(brandId) {
  return String.raw`// Bastion Web Linter (content script)
(function () {
  var API = "${EXTENSION_API_URL}";
  var BRAND_ID = "__BRAND__";
  var PENALTY = { CRITICAL_LEGAL: 25, MEDIUM: 10, LOW: 3 };
  var timer = null;
  var activeEl = null;
  var flags = [];

  var host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" +
    ".wrap{display:flex;flex-direction:column;align-items:flex-end}" +
    ".pill{font:500 12px/1 system-ui,sans-serif;color:#f1f5f9;background:#0f172a;border:1px solid #334155;border-radius:999px;padding:9px 14px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)}" +
    ".panel{width:320px;max-height:280px;overflow:auto;margin-bottom:8px;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:8px;font:12px/1.4 system-ui,sans-serif;color:#cbd5e1}" +
    ".row{padding:8px;border-radius:8px}.row:hover{background:#131c31}" +
    "del{background:rgba(239,68,68,.15);color:#fecaca}" +
    "ins{background:rgba(16,185,129,.15);color:#a7f3d0;text-decoration:none}" +
    ".apply{margin-top:6px;background:#4f46e5;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font:500 11px system-ui,sans-serif}" +
    "[hidden]{display:none}" +
    "</style>" +
    '<div class="wrap"><div class="panel" hidden></div><button class="pill" hidden>Bastion</button></div>';
  document.documentElement.appendChild(host);
  var panel = root.querySelector(".panel");
  var pill = root.querySelector(".pill");

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function getText(el) {
    return "value" in el ? el.value : el.innerText;
  }

  function render() {
    var penalty = 0;
    flags.forEach(function (f) { penalty += PENALTY[f.severity] || 0; });
    var score = Math.max(0, 100 - penalty);
    pill.hidden = false;
    pill.textContent = "Score " + score + "/100 \u2022 " + flags.length + " flag" + (flags.length === 1 ? "" : "s");
    panel.innerHTML = flags.length
      ? flags.map(function (f, i) {
          return '<div class="row"><div><del>' + esc(f.exact_quote) + "</del> \u2192 <ins>" + esc(f.surgical_fix) +
            "</ins></div><div>" + esc(f.rule_id) + ": " + esc(f.explanation) + '</div><button class="apply" data-i="' + i + '">Apply fix</button></div>';
        }).join("")
      : '<div class="row">No flags. This copy matches the brand manifest.</div>';
  }

  function lint(el) {
    var text = getText(el);
    if (!text || text.trim().length < 20) {
      pill.hidden = true;
      panel.hidden = true;
      return;
    }
    fetch(API + "/api/v1/review/" + BRAND_ID, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_id: BRAND_ID,
        draft_text: text,
        has_alt_text: true,
        alt_text: "Page content",
        fg_hex: "#FFFFFF",
        bg_hex: "#0F172A"
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        flags = (data.flags || []).filter(function (f) {
          return f.category !== "ACCESSIBILITY" && f.status === "OPEN";
        });
        render();
      })
      .catch(function () {
        pill.hidden = false;
        pill.textContent = "Bastion offline";
      });
  }

  function apply(flag) {
    var el = activeEl;
    if (!el) return;
    if ("value" in el) {
      el.value = el.value.split(flag.exact_quote).join(flag.surgical_fix);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.focus();
      if (window.find && window.find(flag.exact_quote, true, false, true)) {
        document.execCommand("insertText", false, flag.surgical_fix);
      }
    }
  }

  pill.addEventListener("click", function () { panel.hidden = !panel.hidden; });
  panel.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".apply") : null;
    if (btn) apply(flags[Number(btn.getAttribute("data-i"))]);
  });

  document.addEventListener("input", function (e) {
    var t = e.target;
    var el = t && t.closest ? t.closest("textarea, input[type=text], [contenteditable=''], [contenteditable='true']") : null;
    if (!el || host.contains(el)) return;
    activeEl = el;
    clearTimeout(timer);
    timer = setTimeout(function () { lint(el); }, 700);
  }, true);
})();
`.replace("__BRAND__", brandId);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function CodeBlock({ filename, code }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (await copyToClipboard(code)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#090D16]">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <span className="font-mono text-xs text-slate-400">{filename}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-slate-100"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-slate-300">{code}</pre>
    </div>
  );
}

/* ============================================================================
   Component
   ========================================================================== */

export default function WebLinterModal({ isOpen, onClose, manifest }) {
  const [tab, setTab] = useState("sandbox");
  const [title, setTitle] = useState(SAMPLE_TITLE);
  const [body, setBody] = useState(SAMPLE_BODY);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const panelRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (isOpen) setTab("sandbox");
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

  // Runs synchronously on every keystroke; the engine is pure regex so this stays well under 10 ms.
  const audit = useMemo(() => lintText(body, manifest), [body, manifest]);
  const segments = useMemo(() => buildSegments(body, audit.flags), [body, audit.flags]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 160)}px`;
  }, [body, tab, isOpen]);

  const brandId = manifest?.brand_id || "meridian-pay";
  const extensionManifest = useMemo(() => buildManifestJson(), []);
  const contentScript = useMemo(() => buildContentJs(brandId), [brandId]);

  if (!isOpen) return null;

  const applyFix = (flag) => setBody((b) => b.split(flag.exact_quote).join(flag.surgical_fix));
  const applyAll = () => {
    setBody((b) => audit.flags.reduce((text, f) => text.split(f.exact_quote).join(f.surgical_fix), b));
  };
  const reset = () => {
    setTitle(SAMPLE_TITLE);
    setBody(SAMPLE_BODY);
  };

  const count = audit.flags.length;
  const hasCritical = audit.flags.some((f) => f.severity === "CRITICAL_LEGAL");
  const dot = count === 0 ? "bg-emerald-400" : hasCritical ? "bg-red-400" : "bg-amber-400";

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
        aria-labelledby="web-linter-title"
        className="modal-rise flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0F172A] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div>
            <h2 id="web-linter-title" className="text-lg font-semibold tracking-tight text-slate-100">
              Web linter
            </h2>
            <p className="mt-1 text-sm text-slate-400">Bring brand checks into the tools your team already writes in.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6">
          <div role="tablist" className="inline-flex rounded-lg border border-slate-800 bg-[#090D16] p-0.5">
            {[
              ["sandbox", "Live Linter Sandbox"],
              ["extension", "Chrome Extension Code"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-md px-3.5 py-1.5 text-sm transition-colors ${
                  tab === id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
          {tab === "sandbox" ? (
            <div>
              <div className="relative rounded-xl border border-slate-800 bg-[#0B1120]">
                <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs text-slate-500">
                  <span>Workspace / Marketing / Launch</span>
                  <button onClick={reset} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset sample
                  </button>
                </div>

                <div className="max-h-[48vh] overflow-y-auto pb-24">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Page title"
                    className="w-full bg-transparent px-[22px] pb-1 pt-6 text-3xl font-semibold tracking-tight text-slate-100 placeholder:text-slate-600 focus:outline-none"
                    placeholder="Untitled"
                  />
                  <div className="relative">
                    <div aria-hidden="true" className="canvas-type pointer-events-none absolute inset-0 text-transparent">
                      {segments.map((s, i) =>
                        s.sev ? (
                          <mark key={i} className={`${SEVERITY[s.sev].mark} ${s.id === activeId ? "hl-active" : ""} text-transparent`}>
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
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      spellCheck={false}
                      aria-label="Page content"
                      placeholder="Start typing. Bastion lints as you write."
                      className="canvas-type relative block w-full resize-none overflow-hidden border-0 bg-transparent text-slate-200 caret-white outline-none placeholder:text-slate-600 focus-visible:outline-none"
                    />
                  </div>
                </div>

                {/* Floating Bastion widget */}
                <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-2">
                  {panelOpen && (
                    <div
                      className="fade-in pointer-events-auto w-[min(24rem,calc(100vw-5rem))] overflow-hidden rounded-xl border border-slate-700 bg-[#0F172A] shadow-2xl"
                      role="region"
                      aria-label="Bastion suggestions"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                        <span className="text-xs text-slate-400">
                          {count === 0 ? "No suggestions" : `${count} suggestion${count === 1 ? "" : "s"}`}
                          <span className="font-mono"> · linted in {audit.ms.toFixed(1)} ms</span>
                        </span>
                        {count > 1 && (
                          <button onClick={applyAll} className="text-xs font-medium text-indigo-300 hover:text-indigo-200">
                            Fix all
                          </button>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {count === 0 ? (
                          <p className="px-4 py-5 text-sm text-slate-400">This copy matches the brand manifest.</p>
                        ) : (
                          <ul className="divide-y divide-slate-800">
                            {audit.flags.map((f) => (
                              <li
                                key={f.flag_id}
                                onMouseEnter={() => setActiveId(f.flag_id)}
                                onMouseLeave={() => setActiveId(null)}
                                className="px-4 py-3 hover:bg-[#131c31]"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${(SEVERITY[f.severity] || SEVERITY.LOW).badge}`}>
                                    {(SEVERITY[f.severity] || SEVERITY.LOW).label}
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-500">{f.rule_id}</span>
                                </div>
                                <p className="mt-2 break-words text-sm leading-relaxed text-slate-300">
                                  <del className="diff-del">{f.exact_quote}</del> <span className="text-slate-500">becomes</span>{" "}
                                  <ins className="diff-ins">{f.surgical_fix}</ins>
                                </p>
                                <button
                                  onClick={() => applyFix(f)}
                                  className="mt-2 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                                >
                                  Apply fix
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => setPanelOpen((v) => !v)}
                    aria-expanded={panelOpen}
                    className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-700 bg-[#0F172A] px-4 py-2 text-xs font-medium text-slate-100 shadow-xl hover:border-slate-500"
                  >
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="font-mono">
                      Score {audit.score}/100 • {count} flag{count === 1 ? "" : "s"}
                    </span>
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Type or paste anything above. The same rules run in your browser with no network call.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
                <span className="rounded-full border border-slate-800 bg-[#090D16] px-3 py-1 font-mono text-xs text-slate-300">{EXTENSION_API_URL}</span>
                <span>Brand</span>
                <span className="rounded-full border border-slate-800 bg-[#090D16] px-3 py-1 font-mono text-xs text-slate-300">{brandId}</span>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-400">
                <li>Create a folder called bastion-linter and save the two files below inside it.</li>
                <li>Open chrome://extensions and switch on Developer mode.</li>
                <li>Choose Load unpacked and select the folder. Type in any textarea or editable field to see the badge.</li>
              </ol>
              <CodeBlock filename="manifest.json" code={extensionManifest} />
              <CodeBlock filename="content.js" code={contentScript} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
