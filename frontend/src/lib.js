// Shared helpers: API client, WCAG math, role permissions, severity styling, scoring.

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const BRAND_ID = "meridian-pay";
export const OVERRIDE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// API client. Errors with a `status` came from the server; errors without one are network failures.
// ---------------------------------------------------------------------------
export async function api(method, path, body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Roles & permissions (mirrors the backend)
// ---------------------------------------------------------------------------
export const ROLES = ["Creator", "Brand Manager", "Legal Reviewer", "Accessibility Reviewer"];

const OVERRIDE_CATEGORIES = {
  Creator: [],
  "Brand Manager": ["TONE", "TERMINOLOGY", "FACT_CLAIM", "ACCESSIBILITY"],
  "Legal Reviewer": ["TONE", "TERMINOLOGY", "FACT_CLAIM", "ACCESSIBILITY"],
  "Accessibility Reviewer": ["ACCESSIBILITY"],
};

export function canOverride(role, flag) {
  const cats = OVERRIDE_CATEGORIES[role] || [];
  if (!cats.includes(flag.category)) return false;
  return flag.severity !== "CRITICAL_LEGAL" || role === "Legal Reviewer";
}

export function overrideHint(role, flag) {
  if (canOverride(role, flag)) return "";
  if (role === "Creator") return "Creators can accept fixes. Overrides need a reviewer role.";
  if (flag.severity === "CRITICAL_LEGAL") return "Only a Legal Reviewer can override critical legal flags.";
  if (role === "Accessibility Reviewer") return "Accessibility Reviewers can only override accessibility flags.";
  return "This role cannot override this flag.";
}

export const canPublish = (role) => role === "Brand Manager" || role === "Legal Reviewer";
export const canAcceptPR = (role) => role === "Brand Manager" || role === "Legal Reviewer";

// ---------------------------------------------------------------------------
// Severity + workflow styling
// ---------------------------------------------------------------------------
export const SEVERITY = {
  CRITICAL_LEGAL: {
    rank: 0,
    label: "Critical legal",
    badge: "bg-bastion-danger/15 text-red-300 ring-1 ring-inset ring-bastion-danger/40",
    mark: "hl-critical",
    dot: "bg-bastion-danger",
  },
  MEDIUM: {
    rank: 1,
    label: "Medium",
    badge: "bg-bastion-amber/15 text-amber-300 ring-1 ring-inset ring-bastion-amber/40",
    mark: "hl-medium",
    dot: "bg-bastion-amber",
  },
  LOW: {
    rank: 2,
    label: "Low",
    badge: "bg-indigo-400/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/40",
    mark: "hl-low",
    dot: "bg-indigo-400",
  },
};

export const CATEGORY_LABEL = {
  TONE: "Tone",
  FACT_CLAIM: "Fact claim",
  ACCESSIBILITY: "Accessibility",
  TERMINOLOGY: "Terminology",
};

export const STATUS_STYLES = {
  DRAFT: { label: "Draft", cls: "bg-slate-500/15 text-slate-300 ring-slate-400/30" },
  NEEDS_REVIEW: { label: "Needs review", cls: "bg-bastion-amber/15 text-amber-300 ring-bastion-amber/40" },
  LEGAL_HOLD: { label: "Legal hold", cls: "bg-bastion-danger/15 text-red-300 ring-bastion-danger/40" },
  APPROVED: { label: "Approved", cls: "bg-bastion-ok/15 text-emerald-300 ring-bastion-ok/40" },
};

const PENALTY = { CRITICAL_LEGAL: 25, MEDIUM: 10, LOW: 3 };

export function computeScore(flags) {
  const penalty = flags.filter((f) => f.status === "OPEN").reduce((sum, f) => sum + (PENALTY[f.severity] || 0), 0);
  return Math.max(0, 100 - penalty);
}

export function deriveStatus(flags, reviewed) {
  if (!reviewed) return "DRAFT";
  const open = flags.filter((f) => f.status === "OPEN");
  if (open.some((f) => f.severity === "CRITICAL_LEGAL")) return "LEGAL_HOLD";
  if (open.length) return "NEEDS_REVIEW";
  return "APPROVED";
}

export function sortFlags(flags, draft) {
  return [...flags].sort((a, b) => {
    const ra = (SEVERITY[a.severity] || { rank: 9 }).rank;
    const rb = (SEVERITY[b.severity] || { rank: 9 }).rank;
    if (ra !== rb) return ra - rb;
    const pa = draft.indexOf(a.exact_quote);
    const pb = draft.indexOf(b.exact_quote);
    return (pa < 0 ? 1e9 : pa) - (pb < 0 ? 1e9 : pb);
  });
}

// Replace every occurrence of the flagged substring with the surgical fix.
export function applyFix(draft, flag) {
  if (!flag.exact_quote) return draft;
  return draft.split(flag.exact_quote).join(flag.surgical_fix);
}

export function daysUntil(isoDate) {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

// ---------------------------------------------------------------------------
// WCAG 2.1 math
// ---------------------------------------------------------------------------
export function hexToRgb(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value || "").trim());
  if (!m) return null;
  let d = m[1];
  if (d.length === 3) d = d.split("").map((c) => c + c).join("");
  return [parseInt(d.slice(0, 2), 16), parseInt(d.slice(2, 4), 16), parseInt(d.slice(4, 6), 16)];
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Returns the raw ratio (1–21) or null when either color is invalid.
export function contrastRatio(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// Floor to 2dp so a failing ratio never displays as a pass (4.496 must not show as 4.5).
export const floor2 = (n) => Math.floor(n * 100) / 100;

export function wcagLevel(ratio) {
  if (ratio === null) return "FAIL";
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "FAIL";
}

export const normalizeHex = (v) => {
  const rgb = hexToRgb(v);
  return rgb ? "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase() : null;
};
