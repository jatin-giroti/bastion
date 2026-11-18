// Offline demo data + a small client-side audit engine, so the UI never renders empty and every
// interaction (review, accept, override, guideline PR) still works when the API is unreachable.
import { contrastRatio, floor2, hexToRgb, wcagLevel, computeScore, deriveStatus, normalizeHex } from "./lib.js";

const R = String.raw;

export const FALLBACK_MANIFEST = {
  brand_id: "meridian-pay",
  brand_name: "Meridian Pay",
  version: "2.4.0",
  updated_at: "2026-09-30T00:00:00+00:00",
  approved_hex_palette: ["#0F172A", "#1E293B", "#4F46E5", "#10B981", "#F8FAFC"],
  wcag_min_ratio: 4.5,
  voice_rules: [
    {
      rule_id: "TONE-01", type: "tone", name: "Confident, not boastful",
      description: "State capabilities plainly with evidence. Avoid superlatives and comparative boasting unless backed by the Approved Fact Ledger.",
      tone_vector: { formality: 0.65, warmth: 0.55, confidence: 0.8, urgency: 0.1 },
      citation: "Section 2.1 — Voice & Tone (Brand Guidelines v2.4)",
    },
    {
      rule_id: "TONE-02", type: "tone", name: "Plain language",
      description: "Write for a finance lead, not a quant. Prefer short sentences and concrete verbs; define jargon on first use.",
      tone_vector: { formality: 0.6, warmth: 0.6, confidence: 0.7, urgency: 0.1 },
      citation: "Section 2.2 — Plain Language (Brand Guidelines v2.4)",
    },
    {
      rule_id: "TONE-03", type: "tone", name: "No pressure tactics",
      description: "Never manufacture urgency or fear of missing out (e.g. 'act now', 'last chance', 'don't miss out') in financial product messaging.",
      tone_vector: { formality: 0.65, warmth: 0.5, confidence: 0.7, urgency: 0.05 },
      citation: "Section 2.4 — Responsible Persuasion (Brand Guidelines v2.4)",
    },
    {
      rule_id: "TONE-04", type: "tone", name: "Inclusive & respectful",
      description: "Avoid idioms, gendered defaults, and language that assumes customer size, geography, or financial sophistication.",
      tone_vector: { formality: 0.6, warmth: 0.7, confidence: 0.65, urgency: 0.1 },
      citation: "Section 2.6 — Inclusive Language (Brand Guidelines v2.4)",
    },
    {
      rule_id: "DISC-01", type: "required_disclaimer", category: "FACT_CLAIM", severity: "CRITICAL_LEGAL",
      trigger_patterns: [R`\breturns?\b`, R`\bROI\b`, R`\byields?\b`, R`\bAPY\b`, R`\bAPR\b`, R`\binvest(?:ment|ments|ing)?\b`, R`\bprofits?\b`],
      required_phrases: ["past performance", "results may vary"],
      required_text: "past performance is not indicative of future results",
      citation: "Section 5.3 — Required Financial Disclaimers (Legal Policy LP-12)",
      explanation: "Copy that references returns, ROI, yield or investment must carry the approved performance disclaimer.",
    },
    {
      rule_id: "DISC-02", type: "required_disclaimer", category: "TERMINOLOGY", severity: "CRITICAL_LEGAL",
      trigger_patterns: [R`\bFDIC\b`, R`\bdeposits?\b`, R`\binsured\b`, R`\bbank[\s-]grade\b`],
      required_phrases: ["not a bank"],
      required_text: "Meridian Pay is a financial technology company, not a bank",
      citation: "Section 5.5 — Regulatory Status Disclosure (Legal Policy LP-14)",
      explanation: "Banking-adjacent language requires the regulatory status disclosure so customers are not misled about deposit protection.",
    },
  ],
  banned_terms: [
    {
      rule_id: "TERM-01", term: "#1 fastest in the world",
      pattern: R`(?<![\w#])#\s?1\s+fastest(?:\s+in\s+the\s+world)?\b`,
      category: "TERMINOLOGY", severity: "CRITICAL_LEGAL", replacement: "engineered for speed",
      citation: "Section 3.1 — Prohibited Superlatives (Brand Guidelines v2.4)",
      explanation: "Unsubstantiated absolute superlative. No third-party benchmark supports a global #1 speed ranking.",
    },
    {
      rule_id: "TERM-02", term: "100% guaranteed ROI",
      pattern: R`\b(?:100\s?%\s+)?guaranteed\s+(?:ROI|returns?)\b`,
      category: "TERMINOLOGY", severity: "CRITICAL_LEGAL", replacement: "measurable ROI",
      citation: "Section 3.2 — Prohibited Guarantees (Legal Policy LP-09)",
      explanation: "Guaranteeing financial outcomes is prohibited; it creates misrepresentation and securities-style liability.",
    },
    {
      rule_id: "TERM-03", term: "risk-free", pattern: R`\brisk[\s-]?free\b`,
      category: "TERMINOLOGY", severity: "CRITICAL_LEGAL", replacement: "lower-risk",
      citation: "Section 3.3 — Prohibited Risk Claims (Legal Policy LP-09)",
      explanation: "No financial product or payment rail is risk-free; use calibrated risk language.",
    },
    {
      rule_id: "TERM-04", term: "zero fees forever", pattern: R`\bzero[\s-]+fees?\s+(?:forever|for\s+life)\b`,
      category: "TERMINOLOGY", severity: "CRITICAL_LEGAL", replacement: "transparent, published pricing",
      citation: "Section 3.4 — Pricing Claims (Fact Ledger FACT-005)",
      explanation: "Permanent fee waivers are not offered; pricing is published and can change with volume tiers.",
    },
    {
      rule_id: "TERM-05", term: "instant global settlement", pattern: R`\binstant\s+global\s+settlement\b`,
      category: "TERMINOLOGY", severity: "CRITICAL_LEGAL",
      replacement: "settlement in under 2 seconds for 98% of domestic rails (SLA v2.4)",
      citation: "Section 4.2 — Approved Fact Ledger v2.4 (FACT-001)",
      explanation: "Settlement is not instant or global; the approved claim is limited to domestic rails with the SLA v2.4 percentile.",
    },
    {
      rule_id: "TERM-06", term: "hype vocabulary",
      pattern: R`\b(?:game[\s-]?chang(?:er|ing)|revolutionary|disruptive|world[\s-]class)\b`,
      category: "TERMINOLOGY", severity: "LOW", replacement: "modern",
      citation: "Section 3.7 — Hype Vocabulary (Brand Guidelines v2.4)",
      explanation: "Hype adjectives conflict with the confident-not-boastful voice (TONE-01).",
    },
  ],
  fact_ledger: [
    {
      claim_id: "FACT-001", category: "PERFORMANCE",
      approved_statement: "Settlement completes in under 2 seconds for 98% of domestic rails (SLA v2.4)",
      allowed_metrics: ["2 seconds", "98%", "domestic rails"],
      source_citation: "Meridian Pay SLA v2.4, Section 3.1", expires_at: "2027-03-31",
    },
    {
      claim_id: "FACT-002", category: "RELIABILITY",
      approved_statement: "99.99% historical platform uptime across Q1-Q3 2026",
      allowed_metrics: ["99.99%", "Q1-Q3 2026"],
      source_citation: "Platform Status Audit Report, Q3 2026", expires_at: "2026-12-31",
    },
    {
      claim_id: "FACT-003", category: "SECURITY",
      approved_statement: "SOC2 Type II and ISO 27001 certified",
      allowed_metrics: ["SOC2 Type II", "ISO 27001"],
      source_citation: "Compliance Registry — External Audit Letters 2026", expires_at: "2027-06-30",
    },
    {
      claim_id: "FACT-004", category: "COVERAGE",
      approved_statement: "Payments supported in 42 currencies; settlement speeds vary by corridor",
      allowed_metrics: ["42 currencies"],
      source_citation: "Corridor Coverage Matrix v3.1", expires_at: "2027-01-31",
    },
    {
      claim_id: "FACT-005", category: "PRICING",
      approved_statement: "Published pricing starts at 0.4% per domestic transaction, with volume tiers available",
      allowed_metrics: ["0.4%", "volume tiers"],
      source_citation: "Public Pricing Schedule, effective 2026-07-01", expires_at: "2026-12-31",
    },
  ],
};

export const SAMPLE_DRAFTS = [
  {
    id: "risky",
    label: "Risky launch copy",
    description: "Banned superlatives, guaranteed returns, a misquoted uptime figure and a missing disclaimer. Lands on legal hold.",
    text:
      "Meet the #1 fastest in the world payments platform. Enjoy risk-free returns with 100% guaranteed ROI, zero fees forever, and instant global settlement. Our game-changing, revolutionary, world-class engine delivers 99.999% uptime. Act now — this limited-time offer ends tonight!",
    fg: "#94A3B8", bg: "#F8FAFC", hasAlt: true, altText: "Meridian Pay launch banner showing a payment settling in real time",
  },
  {
    id: "hype",
    label: "Hype vocabulary",
    description: "Three low-severity terminology flags under one rule. Override each as a Brand Manager to trigger a guideline PR.",
    text:
      "Our game-changing settlement engine is built for teams that want a revolutionary way to move money. Join the world-class network that finance leaders already rely on, with published pricing and support in every time zone.",
    fg: "#F8FAFC", bg: "#4F46E5", hasAlt: true, altText: "Finance team reviewing a settlement report on a shared screen",
  },
  {
    id: "tone",
    label: "Tone check",
    description: "Jargon, boasting and pressure tactics across the three tone rules.",
    text:
      "Our holistic platform leverages synergies to seamlessly utilize cutting-edge rails. It is unbeatable, truly best-in-class!!! Don't miss out.",
    fg: "#F8FAFC", bg: "#1E293B", hasAlt: false, altText: "",
  },
  {
    id: "facts",
    label: "Fact ledger check",
    description: "Misstated metrics, an unlisted certification, unbacked statistics and a fact that expires soon.",
    text:
      "Meridian Pay settles payments in 1 second for 99% of rails and supports 120 currencies. We're SOC2 Type II and HIPAA certified, with 99.99% historical platform uptime across Q1-Q3 2026. Trusted by 4,000 merchants and growing 300% a year.",
    fg: "#F8FAFC", bg: "#4F46E5", hasAlt: true, altText: "Map of supported payment corridors",
  },
  {
    id: "clean",
    label: "Compliant release",
    description: "Every claim matches the Approved Fact Ledger. Approves with no open flags.",
    text:
      "Meridian Pay settles in under 2 seconds for 98% of domestic rails (SLA v2.4). We are SOC2 Type II and ISO 27001 certified, and every payment comes with a clear audit trail your team can export.",
    fg: "#F8FAFC", bg: "#4F46E5", hasAlt: true, altText: "Dashboard showing settlement times by region",
  },
];

// ---------------------------------------------------------------------------
// Client-side audit engine (mirrors the backend's deterministic pre-flight + fallback agents)
// ---------------------------------------------------------------------------
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rid = () => `flag_${Math.random().toString(16).slice(2, 14)}`;

function matchCase(original, replacement) {
  if (!replacement) return replacement;
  const letters = original.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && original === original.toUpperCase()) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original) && /^[a-z]/.test(replacement)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

const TONE_SPECS = [
  ["TONE-01", "MEDIUM", "Boastful or superlative phrasing conflicts with the confident-not-boastful voice; state the capability plainly.", [
    [/\bbest[\s-]in[\s-]class\b/gi, "high-performing"], [/\bunbeatable\b/gi, "competitive"],
    [/\b(?:unmatched|unparalleled|unrivall?ed)\b/gi, "strong"], [/\bsecond[\s-]to[\s-]none\b/gi, "well regarded"],
    [/\b(?:industry|market)[\s-]leading\b/gi, "established"], [/\b(?:lightning|blazing(?:ly)?)[\s-]fast\b/gi, "fast"],
    [/\bthe\s+best\b/gi, "a dependable"], [/!{2,}/g, "."],
  ]],
  ["TONE-02", "LOW", "Jargon or buzzwords break the plain-language rule; use the concrete everyday verb or adjective.", [
    [/\bsynerg(?:y|ies)\b/gi, { synergy: "collaboration", synergies: "collaboration" }],
    [/\bleverag(?:e|es|ed|ing)\b/gi, { leverage: "use", leverages: "uses", leveraged: "used", leveraging: "using" }],
    [/\butili[sz](?:e|es|ed|ing)\b/gi, { utilize: "use", utilizes: "uses", utilized: "used", utilizing: "using", utilise: "use", utilises: "uses", utilised: "used", utilising: "using" }],
    [/\bparadigm\s+shift\b/gi, "change"], [/\bbest[\s-]of[\s-]breed\b/gi, "high-quality"],
    [/\bholistic(?:ally)?\b/gi, { holistic: "complete", holistically: "completely" }],
    [/\bseamless(?:ly)?\b/gi, { seamless: "smooth", seamlessly: "smoothly" }],
    [/\brobust\b/gi, "reliable"], [/\b(?:cutting|bleeding)[\s-]edge\b/gi, "modern"], [/\bnext[\s-]gen(?:eration)?\b/gi, "modern"],
  ]],
  ["TONE-03", "MEDIUM", "Manufactured urgency or fear of missing out is not allowed in financial product messaging.", [
    [/\bact\s+now\b/gi, "get started when you're ready"], [/\bdon['\u2019]?t\s+miss\s+out\b/gi, "see what's included"],
    [/\blast\s+chance\b/gi, "see current options"], [/\blimited[\s-]time(?:\s+offer)?\b/gi, "current offer"],
    [/\btoday\s+only\b/gi, "available now"], [/\bends\s+(?:tonight|soon|today)\b/gi, "has published terms"],
    [/\bhurry\b/gi, "take a look"], [/\bonly\s+\d+\s+(?:spots|seats|slots)\s+left\b/gi, "spots are available"],
    [/\bbefore\s+it['\u2019]?s\s+too\s+late\b/gi, "when you're ready"],
  ]],
];

const STAT_RX = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kmb]\b|million|billion|trillion))?|\d[\d,]*(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?[x\u00d7](?![a-z])|\d+(?:\.\d+)?\s?(?:ms|milliseconds?|seconds?|secs?|minutes?|hours?)\b|\d[\d,]*\+?\s+(?:currencies|countries|customers|clients|merchants|users|businesses|banks|partners|transactions)\b/gi;
const CERT_RX = /\b(?:HIPAA|PCI[\s-]?DSS|GDPR|CCPA|FedRAMP|SOC\s?[123]|ISO\s?\d{4,5})\b/gi;
const TOPICS = {
  PERFORMANCE: /settle\w*|speed|fast\w*|latency|instant\w*|seconds?|rails?|real[\s-]time/gi,
  RELIABILITY: /uptime|availab\w*|reliab\w*|outage|downtime/gi,
  SECURITY: /soc\s?\d|iso\s?\d|certif\w*|complian\w*|audit\w*/gi,
  COVERAGE: /currenc\w*|countr\w*|corridor\w*|global\w*|worldwide/gi,
  PRICING: /fees?|pricing|price|cost\w*|per\s+transaction|charge\w*/gi,
};

function kindOf(tok) {
  const t = tok.toLowerCase().trim();
  if (t.startsWith("$")) return "money";
  if (t.endsWith("%")) return "percent";
  if (/\d\s?[x\u00d7]$/.test(t)) return "multiplier";
  if (/(?:ms|milliseconds?|seconds?|secs?|minutes?|hours?)$/.test(t)) return "time";
  return "count";
}

function claimFlags(draft, manifest, mk) {
  const out = [];
  const facts = manifest.fact_ledger.map((f) => ({
    ...f, cat: f.category.toUpperCase(), blob: [f.approved_statement, ...f.allowed_metrics].join(" ").toLowerCase(),
    expires: Date.parse(f.expires_at),
  }));
  const compact = facts.map((f) => f.blob).join(" ").replace(/\s+/g, "");
  const bounds = [...draft.matchAll(/[.!?\n]+(?=\s|$)/g)].map((m) => m.index + m[0].length);
  const ver = manifest.version.split(".").slice(0, 2).join(".");
  const sentence = (pos) => {
    const s = Math.max(0, ...bounds.filter((b) => b <= pos));
    const e = Math.min(draft.length, ...bounds.filter((b) => b > pos));
    return [s, e];
  };
  const backed = (norm, blob) => new RegExp("(?<![\\d.,])" + escapeRx(norm) + "(?!\\d)").test(blob);

  for (const m of draft.matchAll(STAT_RX)) {
    const tok = m[0];
    const start = m.index;
    const end = start + tok.length;
    const norm = tok.toLowerCase().replace(/\s+/g, " ").trim();
    const kind = kindOf(tok);
    const backing = facts.find((f) => backed(norm, f.blob));
    if (backing) {
      const days = Math.ceil((backing.expires - Date.now()) / 86400000);
      if (days < 0) out.push(mk("FACT_CLAIM", "CLAIM-03", "Section 4.3 — Fact Ledger Expiry Policy (Legal Policy LP-08)", tok, `${backing.claim_id} expired on ${backing.expires_at}; this figure can no longer be published as approved.`, "[re-verify figure]", "MEDIUM"));
      else if (days <= 60) out.push(mk("FACT_CLAIM", "CLAIM-03", "Section 4.3 — Fact Ledger Expiry Policy (Legal Policy LP-08)", tok, `${backing.claim_id} expires in ${days} day${days === 1 ? "" : "s"} (${backing.expires_at}). Renew it in the Fact Ledger before this copy runs past that date.`, tok, "LOW"));
      continue;
    }
    const [s0, s1] = sentence(start);
    const sent = draft.slice(s0, s1);
    let best = null;
    let bestDist = 71;
    for (const f of facts) {
      const rx = TOPICS[f.cat];
      if (!rx) continue;
      for (const t of sent.matchAll(rx)) {
        const ms = s0 + t.index;
        const me = ms + t[0].length;
        const dist = ms < end && me > start ? 0 : Math.min(Math.abs(ms - end), Math.abs(start - me));
        if (dist < bestDist) { best = f; bestDist = dist; }
      }
    }
    if (best) {
      const metric = best.allowed_metrics.find((x) => /\d/.test(x) && kindOf(x) === kind);
      if (metric) {
        out.push(mk("FACT_CLAIM", "CLAIM-04", `Section 4.2 — Approved Fact Ledger v${ver} (${best.claim_id})`, tok, `The draft states ${tok}, but the Approved Fact Ledger (${best.claim_id}) only allows: "${best.approved_statement}".`, metric, "CRITICAL_LEGAL"));
        continue;
      }
    }
    out.push(mk("FACT_CLAIM", "CLAIM-01", "Section 4.1 — Claim Substantiation Policy (Legal Policy LP-07)", tok, `${tok} is a numerical claim with no matching entry in the Approved Fact Ledger.`, "[approved figure]", "CRITICAL_LEGAL"));
  }

  const security = facts.find((f) => f.cat === "SECURITY");
  for (const m of draft.matchAll(CERT_RX)) {
    const tok = m[0];
    if (compact.includes(tok.toLowerCase().replace(/\s+/g, ""))) continue;
    const [s0, s1] = sentence(m.index);
    const sent = draft.slice(s0, s1).toLowerCase();
    const fix = security ? security.allowed_metrics.find((x) => !sent.includes(x.toLowerCase())) || security.approved_statement : "[verified certification]";
    out.push(mk("FACT_CLAIM", "CLAIM-02", "Section 4.4 — Certification Claims (Legal Policy LP-11)", tok, `${tok} is not listed in the Approved Fact Ledger. Certification and compliance claims need a verified, current source.`, fix, "CRITICAL_LEGAL"));
  }
  return out;
}

export function localAudit({ draft, manifest, fg, bg, hasAlt, altText, hasImage }) {
  const t0 = performance.now();
  const mk = (category, rule_id, rule_citation, exact_quote, explanation, surgical_fix, severity) => ({
    flag_id: rid(), category, rule_id, rule_citation, exact_quote, explanation, surgical_fix, severity, status: "OPEN",
  });
  const flags = [];
  const spans = [];
  const overlaps = (s, e) => spans.some(([a, b]) => s < b && e > a);

  // banned terms
  for (const term of manifest.banned_terms) {
    let rx;
    try { rx = new RegExp(term.pattern || escapeRx(term.term).replace(/\s+/g, "\\s+"), "gi"); } catch { continue; }
    for (const m of draft.matchAll(rx)) {
      const s = m.index;
      const e = s + m[0].length;
      if (!m[0] || overlaps(s, e)) continue;
      spans.push([s, e]);
      flags.push(mk(term.category || "TERMINOLOGY", term.rule_id, term.citation, m[0], term.explanation, matchCase(m[0], term.replacement), term.severity || "MEDIUM"));
    }
  }
  // required disclaimers
  for (const rule of manifest.voice_rules.filter((r) => r.type === "required_disclaimer")) {
    const present = (rule.required_phrases || []).some((p) => new RegExp(escapeRx(p).replace(/\s+/g, "\\s+"), "i").test(draft));
    if (present) continue;
    let trig;
    try { trig = new RegExp(rule.trigger_patterns.map((p) => `(?:${p})`).join("|"), "gi"); } catch { continue; }
    for (const m of draft.matchAll(trig)) {
      const s = m.index;
      const e = s + m[0].length;
      if (!m[0] || overlaps(s, e)) continue;
      flags.push(mk(rule.category, rule.rule_id, rule.citation, m[0], `${rule.explanation} Missing: "${rule.required_text}".`, `${m[0]} (${rule.required_text})`, rule.severity));
      break;
    }
  }
  // tone
  const toneSpans = [...spans];
  for (const [rule_id, severity, explanation, pairs] of TONE_SPECS) {
    const citation = (manifest.voice_rules.find((r) => r.rule_id === rule_id) || {}).citation || "Brand Guidelines — Voice & Tone";
    for (const [rx, repl] of pairs) {
      for (const m of draft.matchAll(rx)) {
        const s = m.index;
        const e = s + m[0].length;
        if (!m[0] || toneSpans.some(([a, b]) => s < b && e > a)) continue;
        toneSpans.push([s, e]);
        const next = typeof repl === "object" ? repl[m[0].toLowerCase()] : repl;
        if (next) flags.push(mk("TONE", rule_id, citation, m[0], explanation, matchCase(m[0], next), severity));
      }
    }
  }
  // claims (skip anything overlapping a pre-flight/tone span)
  for (const f of claimFlags(draft, manifest, mk)) {
    const s = draft.indexOf(f.exact_quote);
    if (s >= 0 && toneSpans.some(([a, b]) => s < b && s + f.exact_quote.length > a)) continue;
    flags.push(f);
  }

  // WCAG
  const raw = contrastRatio(fg, bg);
  const min = manifest.wcag_min_ratio || 4.5;
  if (raw === null) {
    flags.push(mk("ACCESSIBILITY", "WCAG-01", "Section 6.1 — Accessibility Standard (WCAG 2.1 SC 1.4.3)", [fg, bg].filter((v) => !hexToRgb(v)).join(", "), "Color value is not a valid hex code, so contrast cannot be verified.", "Provide colors as #RRGGBB.", "MEDIUM"));
  } else {
    if (raw < min) {
      const fgN = normalizeHex(fg);
      const bgN = normalizeHex(bg);
      const pal = manifest.approved_hex_palette;
      const passing = pal.filter((h) => contrastRatio(h, bg) >= Math.max(min, 4.5));
      const dist = (a, b) => { const x = hexToRgb(a); const y = hexToRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
      const pick = passing.length
        ? passing.sort((a, b) => dist(a, fg) - dist(b, fg))[0]
        : contrastRatio("#FFFFFF", bg) >= contrastRatio("#000000", bg) ? "#FFFFFF" : "#000000";
      flags.push(mk("ACCESSIBILITY", "WCAG-01", "Section 6.1 — Accessibility Standard (WCAG 2.1 SC 1.4.3)", `${fgN} on ${bgN}`, `Contrast ratio is ${floor2(raw)}:1, below the required ${min}:1 for body text (3:1 applies only to large text).`, `Change foreground ${fgN} to ${normalizeHex(pick)}`, "MEDIUM"));
    }
    for (const [label, hex] of [["foreground", fg], ["background", bg]]) {
      const rgb = hexToRgb(hex);
      const near = manifest.approved_hex_palette.map((p) => ({ p, d: Math.hypot(...hexToRgb(p).map((v, i) => v - rgb[i])) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d > 12) flags.push(mk("ACCESSIBILITY", "PALETTE-01", "Section 1.3 — Approved Color Palette (Brand Guidelines v2.4)", normalizeHex(hex), `The ${label} color ${normalizeHex(hex)} is not in the approved palette.`, `Replace ${normalizeHex(hex)} with approved ${near.p}`, "LOW"));
    }
  }
  const alt = (altText || "").trim();
  if (!hasAlt || (hasImage && !alt)) {
    flags.push(mk("ACCESSIBILITY", "WCAG-02", "Section 6.2 — Accessibility Standard (WCAG 2.1 SC 1.1.1)", "[alt text missing]", "Non-text content requires a text alternative for screen-reader users.", "Add concise alt text describing the image's message (not just 'image').", "MEDIUM"));
  } else if (alt && (alt.length < 4 || /^(image|photo|picture|graphic|banner|logo|icon|screenshot)$/i.test(alt) || /\.(png|jpe?g|gif|webp|svg)$/i.test(alt))) {
    flags.push(mk("ACCESSIBILITY", "WCAG-02", "Section 6.2 — Accessibility Standard (WCAG 2.1 SC 1.1.1)", alt, "Alt text is generic or a filename and does not convey the image's meaning.", "Describe what the image communicates, e.g. 'Dashboard showing settlement times by region'.", "LOW"));
  }

  const seen = new Set();
  const unique = flags.filter((f) => {
    const k = `${f.category}|${f.rule_id}|${f.exact_quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pre = performance.now() - t0;
  return {
    submission_id: `local_${Date.now().toString(36)}`,
    brand_id: manifest.brand_id,
    status: deriveStatus(unique, true),
    compliance_score: computeScore(unique),
    preflight_latency_ms: Math.round(pre * 1000) / 1000,
    total_latency_ms: Math.round(pre * 1000) / 1000,
    contrast_ratio: raw === null ? 0 : floor2(raw),
    wcag_level: wcagLevel(raw),
    flags: unique,
    triad: { mode: "offline-demo", agents: {} },
    manifest_version: manifest.version,
  };
}

// ---------------------------------------------------------------------------
// Offline Reverse-Governance helpers
// ---------------------------------------------------------------------------
function originalRuleText(ruleId, m) {
  const term = m.banned_terms.find((t) => t.rule_id === ruleId);
  if (term) return `Banned term "${term.term}": ${term.explanation} Approved replacement: "${term.replacement}".`;
  const rule = m.voice_rules.find((r) => r.rule_id === ruleId);
  if (rule) return `${rule.name || ruleId}: ${rule.description || rule.explanation || ""}`.trim();
  const fact = m.fact_ledger.find((f) => f.claim_id === ruleId);
  if (fact) return `Approved claim: ${fact.approved_statement}`;
  return `Rule ${ruleId} as currently written in the BrandManifest.`;
}

export function buildLocalPR(ruleId, reasons, manifest, count) {
  const original = originalRuleText(ruleId, manifest);
  const clean = reasons.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  const tally = {};
  clean.forEach((r) => { tally[r.toLowerCase()] = (tally[r.toLowerCase()] || 0) + 1; });
  const top = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || ["an approved context"])[0].replace(/\.$/, "").slice(0, 140);
  const critical = ["TERM-0", "CLAIM", "DISC"].some((p) => ruleId.startsWith(p)) &&
    [...manifest.banned_terms, ...manifest.voice_rules].some((r) => r.rule_id === ruleId && r.severity === "CRITICAL_LEGAL");
  const clarification = `Clarification: this rule does not apply when ${top}; the reviewer must record that context in the override log${critical ? " and the override is signed off by a Legal Reviewer" : ""}.`;
  const distinct = Object.keys(tally).length;
  return {
    pr_id: `PR-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    rule_id: ruleId,
    original_rule_text: original,
    proposed_rule_text: `${original} ${clarification}`,
    clarification,
    override_count: count,
    sample_reasons: [...new Set(clean)].slice(0, 5),
    rationale: `Reviewers overrode ${ruleId} ${clean.length} times with ${distinct} distinct reason${distinct === 1 ? "" : "s"}. The most cited context was "${top}". Repeated overrides signal the rule is ambiguous or too broad for common cases, so this proposal scopes it explicitly instead of leaving each case to manual override.`,
    status: "OPEN",
    created_at: new Date().toISOString(),
    base_version: manifest.version,
    generated_by: "offline-demo",
  };
}

export function mergeLocalPR(manifest, pr) {
  const m = JSON.parse(JSON.stringify(manifest));
  const text = pr.clarification;
  const amend = { pr_id: pr.pr_id, text, at: new Date().toISOString() };
  let applied = false;
  for (const t of m.banned_terms) if (t.rule_id === pr.rule_id) { t.explanation = `${t.explanation} ${text}`; (t.amendments ||= []).push(amend); applied = true; }
  for (const r of m.voice_rules) if (r.rule_id === pr.rule_id) { const k = "description" in r ? "description" : "explanation"; r[k] = `${r[k]} ${text}`; (r.amendments ||= []).push(amend); applied = true; }
  for (const f of m.fact_ledger) if (f.claim_id === pr.rule_id) { f.source_citation = `${f.source_citation} — Amendment ${pr.pr_id}: ${text}`; applied = true; }
  if (!applied) m.voice_rules.push({ rule_id: pr.rule_id, type: "clarification", name: `${pr.rule_id} clarification`, description: text, citation: `Guideline PR ${pr.pr_id}`, amendments: [amend] });
  const parts = m.version.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  m.version = parts.join(".");
  m.updated_at = new Date().toISOString();
  return m;
}
