import { useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, UploadCloud, X } from "lucide-react";

/* ============================================================================
   Helpers (no JSX below this line until the component)
   ========================================================================== */

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 25000;
const SAMPLE_BRAND = "Aurora Pay";
const SAMPLE_FILENAME = "aurora-pay-brand-guidelines.pdf";

// Sample brand guidelines, one array per PDF page. ASCII only so the hand-built PDF stays valid.
const SAMPLE_PAGES = [
  [
    { text: "Aurora Pay Brand Guidelines 2026", size: 14 },
    { text: "" },
    { text: "Our voice is confident and understated. We never boast, and we write in plain language with short sentences. Our tone should feel warm and human, never robotic. We sound professional and credible in every channel." },
    { text: "" },
    { text: "Colors: Deep Navy #0B1F3A, Aurora Blue #2563EB, Mint #34D399 and Paper #F8FAFC. Never use #FF00FF in any layout." },
    { text: "" },
    { text: "All body text must meet a 4.5:1 contrast ratio against its background (WCAG AA)." },
  ],
  [
    { text: "Language and disclaimers", size: 14 },
    { text: "" },
    { text: 'Never use the phrase "best rates guaranteed" because it is a legal claim we cannot support.' },
    { text: 'Avoid "unbeatable", and use "dependable" instead.' },
    { text: 'Do not say "risk-free" in any financial product copy.' },
    { text: 'Never promise "zero fees forever" because pricing can change with volume tiers.' },
    { text: "Avoid words like synergy, turnkey, game-changing." },
    { text: "" },
    { text: 'Whenever copy mentions returns or yield, it must include the disclaimer "Past performance does not guarantee future results".' },
    { text: "" },
    { text: "Approved facts", size: 14 },
    { text: "" },
    { text: "Approved claim (SLA v3, valid until 2027-06-30): Funds settle in under 3 seconds for 97% of domestic transfers." },
    { text: "Verified by external audit: Aurora Pay is SOC 2 Type II and ISO 27001 certified." },
    { text: "As of Q3 2026 we support 38 currencies, verified against the corridor matrix." },
    { text: "Published pricing starts at 0.4% per domestic transaction, verified in the 2026 price schedule." },
  ],
];

function wrapText(text, width = 92) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const pdfEscape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Builds a small, valid, uncompressed PDF (Helvetica text, correct xref offsets).
function buildSamplePdfBytes(brandName = SAMPLE_BRAND) {
  const objects = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "";
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids = [];
  for (const page of SAMPLE_PAGES) {
    const ops = ["BT", "14 TL", "56 740 Td"];
    for (const item of page) {
      const size = item.size || 10;
      const text = item.text.split(SAMPLE_BRAND).join(brandName);
      const lines = text ? wrapText(text) : [""];
      ops.push(`/F1 ${size} Tf`);
      for (const ln of lines) {
        const safe = pdfEscape(ln.replace(/[^\x20-\x7E]/g, "?"));
        ops.push(`(${safe}) Tj T*`);
      }
    }
    ops.push("ET");
    const stream = ops.join("\n");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentNum = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function buildSampleFile(brandName = SAMPLE_BRAND) {
  return new File([buildSamplePdfBytes(brandName)], SAMPLE_FILENAME, { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Best-effort in-browser PDF text extraction (simple text PDFs, Flate-compressed or not)
// ---------------------------------------------------------------------------
function unescapePdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => {
    if (c === "n") return "\n";
    if (c === "r") return "\r";
    if (c === "t") return "\t";
    if (c === "b" || c === "f") return "";
    if (c === "(" || c === ")" || c === "\\") return c;
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return "";
  });
}

const WIN_ANSI = {
  "\x80": "\u20ac", "\x85": "\u2026", "\x91": "\u2018", "\x92": "\u2019", "\x93": "\u201c", "\x94": "\u201d",
  "\x95": "\u2022", "\x96": "\u2013", "\x97": "\u2014", "\x99": "\u2122",
};
const fixWinAnsi = (text) => text.replace(/[\x80-\x9f]/g, (c) => WIN_ANSI[c] || "");

function textFromContentStream(content) {
  const rx = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|(T\*|T[dD]|ET)/g;
  let out = "";
  let m;
  while ((m = rx.exec(content)) !== null) {
    if (m[1] !== undefined) {
      const part = /\(((?:\\.|[^\\()])*)\)|(-?\d+(?:\.\d+)?)/g;
      let p;
      while ((p = part.exec(m[1])) !== null) {
        if (p[1] !== undefined) out += unescapePdfString(p[1]);
        else if (parseFloat(p[2]) < -250) out += " ";
      }
    } else if (m[2] !== undefined) {
      out += unescapePdfString(m[2]);
    } else if (!out.endsWith("\n")) {
      out += "\n";
    }
  }
  return fixWinAnsi(out).replace(/[ \t]+\n/g, "\n").trim();
}

function ascii85Decode(bytes) {
  let str = new TextDecoder("latin1").decode(bytes).replace(/\s+/g, "");
  if (str.startsWith("<~")) str = str.slice(2);
  const endAt = str.indexOf("~>");
  if (endAt !== -1) str = str.slice(0, endAt);
  const out = [];
  let group = [];
  const flush = () => {
    const n = group.length;
    let v = 0;
    for (let i = 0; i < 5; i += 1) v = v * 85 + (i < n ? group[i] : 84);
    const four = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...four.slice(0, n - 1));
    group = [];
  };
  for (const ch of str) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) flush();
  }
  if (group.length > 1) flush();
  return new Uint8Array(out);
}

function asciiHexDecode(bytes) {
  const hex = new TextDecoder("latin1").decode(bytes).replace(/[^0-9a-fA-F]/g, "");
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return new Uint8Array(out);
}

async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractPdfPages(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const latin = new TextDecoder("latin1").decode(buf);
  const pages = [];
  const rx = /stream\r?\n/g;
  let m;
  while ((m = rx.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end === -1) break;
    const dictStart = latin.lastIndexOf("obj", m.index);
    const dict = latin.slice(Math.max(0, dictStart), m.index);
    let data = buf.slice(start, end);
    try {
      const filterSpec = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || "";
      for (const name of filterSpec.match(/\/(\w+)/g) || []) {
        if (name === "/ASCII85Decode") data = ascii85Decode(data);
        else if (name === "/ASCIIHexDecode") data = asciiHexDecode(data);
        else if (name === "/FlateDecode") data = await inflate(data);
        else throw new Error(`Unsupported filter ${name}`);
      }
    } catch {
      continue;
    }
    const content = new TextDecoder("windows-1252").decode(data); // maps curly quotes and dashes correctly
    if (!/\bBT\b/.test(content) || !/T[jJ]/.test(content)) continue;
    const text = textFromContentStream(content);
    if (text) pages.push([pages.length + 1, text]);
    rx.lastIndex = end + 9;
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Offline compiler (JS port of the backend's heuristic extractor + chunker)
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 550;
const CHUNK_OVERLAP = 100;
const STOP = new Set(
  ("about above after again against all also among and any are because been before being below between both but can could did does " +
    "doing down during each few for from further had has have having her here hers him his how into its itself just more most must " +
    "nor not now off once only other our ours out over own same she should some such than that the their theirs them then there " +
    "these they this those through too under until very was were what when where which while who whom why will with would you your " +
    "yours shall may might per via within without use used using make made makes").split(" ")
);

const collapse = (t) => t.replace(/\s+/g, " ").trim();
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flex = (term) => term.trim().split(/\s+/).map(escapeRx).join("\\s+");
const termPattern = (term) => `(?<!\\w)${flex(term)}(?!\\w)`;
const triggerPattern = (kw) => {
  const base = kw.toLowerCase().endsWith("s") && kw.length > 4 ? kw.slice(0, -1) : kw;
  return `\\b${flex(base)}s?\\b`;
};

export function slugifyBrand(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "brand";
}

function keywordsOf(text, limit = 6) {
  const counts = new Map();
  const order = new Map();
  let i = 0;
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)) {
    const w = m[0].toLowerCase().replace(/^['-]+|['-]+$/g, "");
    i += 1;
    if (w.length < 4 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
    if (!order.has(w)) order.set(w, i);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || order.get(a) - order.get(b)).slice(0, limit);
}

function chunkFlat(flat) {
  const n = flat.length;
  const pieces = [];
  const floor = Math.floor(CHUNK_SIZE * 0.6);
  let start = 0;
  while (start < n) {
    let end = Math.min(start + CHUNK_SIZE, n);
    if (end < n) {
      const win = flat.slice(start, end);
      const cut = Math.max(win.lastIndexOf(". "), win.lastIndexOf("; "), win.lastIndexOf(": "), win.lastIndexOf("? "), win.lastIndexOf("! "));
      if (cut >= floor) end = start + cut + 1;
      else {
        const sp = win.lastIndexOf(" ");
        if (sp >= floor) end = start + sp;
      }
    }
    const piece = flat.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= n) break;
    let next = end - CHUNK_OVERLAP;
    if (next > 0 && flat[next - 1] !== " ") {
      const sp = flat.indexOf(" ", next);
      if (sp !== -1 && sp < end) next = sp + 1;
    }
    start = Math.max(next, start + 1);
  }
  return pieces;
}

function buildChunks(pages) {
  const chunks = [];
  for (const [page, text] of pages) {
    for (const piece of chunkFlat(collapse(text))) {
      if (chunks.length >= 600) return chunks;
      chunks.push({
        chunk_id: `chunk_${String(chunks.length + 1).padStart(4, "0")}`,
        page,
        text: piece,
        keywords: keywordsOf(piece),
      });
    }
  }
  return chunks;
}

function paragraphsOf(text) {
  const out = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.length >= 40 && !/[.!?:;]\s*$/.test(prev) && !/^(?:[\u2022\u00b7*\-\u2013]|\d+[.)])\s/.test(line)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else out.push(line);
  }
  return out;
}

function sentencesOf(pages) {
  const out = [];
  for (const [page, text] of pages) {
    for (const para of paragraphsOf(text)) {
      for (let s of para.split(/(?<=[.!?])\s+/)) {
        s = s.replace(/^[\s\u2022\u00b7*\-\u2013\u2014]+|[\s\u2022\u00b7*\-\u2013\u2014]+$/g, "");
        if (s.length >= 12) out.push([page, s]);
      }
    }
  }
  return out;
}

const QUOTED = /"([^"\u201c\u201d]{2,60})"|\u201c([^\u201d]{2,60})\u201d|\u2018([^\u2019]{2,60})\u2019/g;
const BAN_CUE = /\b(?:never\s+(?:use|say|write|claim|promise)|do\s+not\s+(?:use|say|write|claim)|don['\u2019]t\s+(?:use|say|write|claim)|must\s+not\s+(?:use|say|claim)|avoid|banned|prohibited|forbidden|off[\s-]limits|not\s+(?:permitted|allowed))\b/i;
const INSTEAD = /\b(?:instead|rather)\b[^"\u201c\u2018]{0,30}(?:"([^"]{2,80})"|\u201c([^\u201d]{2,80})\u201d|\u2018([^\u2019]{2,80})\u2019)|\buse\s+(?:"([^"]{2,80})"|\u201c([^\u201d]{2,80})\u201d|\u2018([^\u2019]{2,80})\u2019)\s+instead/i;
const LEGAL = /\b(?:legal|legally|regulat\w*|complian\w*|guarantee\w*|liabil\w*|misleading|deceptive|false|risk[\s-]free|sec|finra|fca)\b/i;
const LIST_TAIL = /(?::|\bsuch\s+as\b|\blike\b|\be\.g\.,?)\s*(.+)$/i;
const TONE_ATTRS = [
  ["Confident, not boastful", /\b(?:confident|assured|understated|boast\w*)\b/i, { confidence: 0.85 }],
  ["Plain language", /\b(?:plain[\s-]language|jargon|simple|clear(?:ly)?|short\s+sentences)\b/i, { formality: 0.55 }],
  ["Warm and human", /\b(?:warm|friendly|human|approachable|empath\w*|conversational)\b/i, { warmth: 0.75 }],
  ["Professional and credible", /\b(?:professional|credible|formal|authoritative|trustworthy)\b/i, { formality: 0.8 }],
  ["Inclusive and respectful", /\b(?:inclusive|respectful|gender[\s-]neutral)\b/i, { warmth: 0.7 }],
];
const TONE_BASE = { formality: 0.6, warmth: 0.55, confidence: 0.7, urgency: 0.1 };
const VOICE_CUE = /\b(?:tone|voice|we\s+(?:are|sound|write|speak)|our\s+(?:brand|writing|copy)|writing|sound\w*)\b/i;
const DISC_CUE = /\b(?:disclaimer|must\s+(?:include|carry|contain|display|read|state)|required\s+(?:text|language|disclosure)|legal\s+(?:notice|line)|disclosure)\b/i;
const TRIGGER = /\b(?:when|whenever|if|any\s+time)\s+(?:copy\s+|content\s+|you\s+|text\s+)?(?:mentions?|references?|discusses?|describes?|refers?\s+to|mentioning|referencing|discussing)\s+([^,.;:]{3,80})/i;
const STAT = /\b\d[\d,]*(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:ms|milliseconds?|seconds?|minutes?|hours?)\b|\b\d[\d,]*\+?\s+(?:currencies|countries|customers|clients|merchants|users|businesses|banks|partners|transactions)\b|\b(?:SOC\s?[123](?:\s+Type\s+I{1,2})?|ISO\s?\d{4,5}|HIPAA|PCI[\s-]?DSS|GDPR|FedRAMP)\b|\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion))?/gi;
const FACT_CUE = /\b(?:approved|verified|certified|audited|sla|as\s+of|uptime|source|ledger|validated|attested|independently|historical)\b|\bQ[1-4]\b|\b20\d{2}\b/i;
const EXPIRES = /(?:expires?|valid\s+(?:until|through|to)|review\s+by)\s*:?\s*(\d{4}-\d{2}-\d{2})/i;
const FACT_TOPICS = [
  ["RELIABILITY", /uptime|availab|reliab|outage/i],
  ["SECURITY", /soc\s?\d|iso\s?\d|certif|hipaa|pci|gdpr|secur|audit/i],
  ["COVERAGE", /currenc|countr|corridor|region|market/i],
  ["PRICING", /\bfees?\b|pricing|price|cost|per\s+transaction/i],
  ["PERFORMANCE", /settle|speed|latency|seconds?|\bms\b|throughput|fast/i],
];

const quotedTerms = (s) => [...s.matchAll(QUOTED)].map((m) => (m[1] || m[2] || m[3]).trim());

function splitList(tail) {
  const out = [];
  for (let piece of tail.split(/,|;|\bor\b|\band\b|\//)) {
    piece = piece.replace(/^[\s."'\u201c\u201d\u2018\u2019()]+|[\s."'\u201c\u201d\u2018\u2019()]+$/g, "");
    piece = piece.replace(/^(?:the|a|an|any|words|phrases|terms)\s+/i, "");
    if (piece.length >= 3 && piece.length <= 40 && piece.split(/\s+/).length <= 4) out.push(piece);
  }
  return out;
}

function compileOffline(brandName, pages) {
  const sentences = sentencesOf(pages);
  const cite = (p) => `${brandName} brand guidelines, page ${p}`;
  const cap = (s, n) => s.replace(/\s+/g, " ").trim().slice(0, n);

  const palette = [];
  for (const [, s] of sentences) {
    if (BAN_CUE.test(s)) continue;
    for (const hx of s.match(/#[0-9A-Fa-f]{6}\b/g) || []) {
      const up = hx.toUpperCase();
      if (!palette.includes(up)) palette.push(up);
    }
  }

  let ratio = 4.5;
  for (const [, s] of sentences) {
    if (/contrast|wcag|accessib/i.test(s)) {
      const m = s.match(/(\d+(?:\.\d+)?)\s?:\s?1/);
      if (m && +m[1] >= 3 && +m[1] <= 7) { ratio = +m[1]; break; }
      if (/\bAAA\b/.test(s)) { ratio = 7; break; }
    }
  }

  const banned = [];
  const seenTerms = new Set();
  for (const [page, s] of sentences) {
    if (!BAN_CUE.test(s)) continue;
    let replacement = "";
    const ins = s.match(INSTEAD);
    if (ins) replacement = (ins.slice(1).find(Boolean) || "").trim();
    let terms = quotedTerms(s).filter((t) => t.toLowerCase() !== replacement.toLowerCase());
    if (!terms.length) {
      const tail = s.match(LIST_TAIL);
      if (tail) terms = splitList(tail[1]);
    }
    for (const term of terms) {
      if (seenTerms.has(term.toLowerCase())) continue;
      seenTerms.add(term.toLowerCase());
      banned.push({
        rule_id: `TERM-${String(banned.length + 1).padStart(2, "0")}`,
        term,
        pattern: termPattern(term),
        category: "TERMINOLOGY",
        severity: LEGAL.test(`${s} ${term}`) ? "CRITICAL_LEGAL" : "MEDIUM",
        replacement: replacement || "[rephrase]",
        citation: cite(page),
        explanation: cap(s, 240),
      });
      if (banned.length >= 40) break;
    }
  }

  const voice = [];
  for (const [name, rx, tweak] of TONE_ATTRS) {
    const hit = sentences.find(([, s]) => s.length <= 300 && rx.test(s) && VOICE_CUE.test(s) && !BAN_CUE.test(s));
    if (hit) {
      voice.push({
        rule_id: `TONE-${String(voice.length + 1).padStart(2, "0")}`, type: "tone", name,
        description: cap(hit[1], 300), tone_vector: { ...TONE_BASE, ...tweak }, citation: cite(hit[0]),
      });
    }
  }
  if (!voice.length) {
    voice.push({
      rule_id: "TONE-01", type: "tone", name: "Brand voice",
      description: "No explicit voice guidance was found in the source PDF. Review and add tone rules manually.",
      tone_vector: { ...TONE_BASE }, citation: `${brandName} brand guidelines`,
    });
  }
  let discCount = 0;
  for (const [page, s] of sentences) {
    if (!DISC_CUE.test(s)) continue;
    const required = quotedTerms(s).sort((a, b) => b.length - a.length).find((q) => q.length >= 15) || "";
    const trig = s.match(TRIGGER);
    const triggers = trig ? splitList(trig[1]) : [];
    if (!required || !triggers.length) continue;
    discCount += 1;
    voice.push({
      rule_id: `DISC-${String(discCount).padStart(2, "0")}`, type: "required_disclaimer",
      category: triggers.some((k) => /return|yield|roi|performance|invest|profit|apy|apr|rate|earn/i.test(k)) ? "FACT_CLAIM" : "TERMINOLOGY",
      severity: "CRITICAL_LEGAL",
      trigger_patterns: triggers.map(triggerPattern),
      required_phrases: [...new Set([required, required.split(/\s+/).slice(0, 4).join(" ")])],
      required_text: required, citation: cite(page), explanation: cap(s, 300),
    });
  }

  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const ledger = [];
  for (const [page, s] of sentences) {
    if (BAN_CUE.test(s) || s.length > 320) continue;
    const metrics = [...s.matchAll(STAT)].map((m) => m[0].trim());
    if (!metrics.length || !FACT_CUE.test(s)) continue;
    const statement = s.replace(/\.$/, "");
    if (ledger.some((f) => f.approved_statement.toLowerCase() === statement.toLowerCase())) continue;
    const exp = s.match(EXPIRES);
    ledger.push({
      claim_id: `FACT-${String(ledger.length + 1).padStart(3, "0")}`,
      category: (FACT_TOPICS.find(([, rx]) => rx.test(s)) || ["GENERAL"])[0],
      approved_statement: statement,
      allowed_metrics: [...new Set(metrics)],
      source_citation: cite(page),
      expires_at: exp ? exp[1] : nextYear,
    });
    if (ledger.length >= 25) break;
  }

  return {
    brand_id: slugifyBrand(brandName),
    brand_name: brandName,
    version: "1.0.0",
    approved_hex_palette: palette.slice(0, 16),
    wcag_min_ratio: ratio,
    voice_rules: voice,
    banned_terms: banned,
    fact_ledger: ledger,
    updated_at: new Date().toISOString(),
  };
}

async function buildManifestInBrowser(file, brandName) {
  const pages = await extractPdfPages(file).catch(() => []);
  const textLength = pages.reduce((n, [, t]) => n + t.length, 0);
  if (textLength >= 150) {
    return { manifest: compileOffline(brandName, pages), chunks: buildChunks(pages), compiledBy: "browser" };
  }
  // Text could not be read offline: build from the bundled starter guidelines instead, and say so.
  const starter = SAMPLE_PAGES.map((page, i) => [
    i + 1,
    page.map((l) => l.text.split(SAMPLE_BRAND).join(brandName)).join("\n"),
  ]);
  return { manifest: compileOffline(brandName, starter), chunks: buildChunks(starter), compiledBy: "offline-starter" };
}

class ServerRejection extends Error {}

const SOURCE_LABEL = {
  claude: "Compiled by Claude on the server.",
  "claude+heuristic": "Compiled by Claude on the server, with rule-based fill for sections it left empty.",
  heuristic: "Compiled by the server's rule-based extractor.",
  browser: "The backend was unreachable, so this manifest was compiled in your browser.",
  "offline-starter":
    "The backend was unreachable and this PDF's text could not be read offline, so a starter manifest was generated. Upload again when the backend is online for a full compile.",
};

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/* ============================================================================
   Component
   ========================================================================== */

export default function PdfIngestModal({ isOpen, onClose, apiUrl, onManifestIngested }) {
  const [brandName, setBrandName] = useState("");
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | working | done | error
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setBrandName("");
    setFile(null);
    setDragOver(false);
    setPhase("idle");
    setStep("");
    setError("");
    setSummary(null);
  }, [isOpen]);

  // Escape to close, scroll lock, focus handling.
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

  if (!isOpen) return null;

  const working = phase === "working";

  const pickFile = (candidate) => {
    if (!candidate) return;
    const isPdf = candidate.type === "application/pdf" || /\.pdf$/i.test(candidate.name);
    if (!isPdf) {
      setError("Choose a PDF file.");
      setPhase("error");
      return;
    }
    if (candidate.size > MAX_PDF_BYTES) {
      setError("That PDF is larger than 15 MB.");
      setPhase("error");
      return;
    }
    setFile(candidate);
    setError("");
    setPhase("idle");
    if (!brandName.trim()) {
      const guess = candidate.name
        .replace(/\.pdf$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b(brand|guidelines?|style|guide)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (guess) setBrandName(guess);
    }
  };

  const run = async (pdfFile, name) => {
    setPhase("working");
    setError("");
    setSummary(null);
    setStep("Uploading to the Bastion API");
    let result = null;
    let offline = false;
    try {
      const form = new FormData();
      form.append("brand_name", name);
      form.append("file", pdfFile, pdfFile.name);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(`${apiUrl || ""}/api/v1/manifests/ingest-pdf`, { method: "POST", body: form, signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          const { rag_chunks, compiled_by, ...manifest } = data;
          result = { manifest, chunks: Array.isArray(rag_chunks) ? rag_chunks : [], compiledBy: compiled_by || "heuristic" };
        } else if (res.status >= 500 || [404, 405, 408, 429].includes(res.status)) {
          offline = true;
        } else {
          const body = await res.json().catch(() => ({}));
          throw new ServerRejection(typeof body.detail === "string" ? body.detail : `Upload failed (${res.status}).`);
        }
      } catch (err) {
        if (err instanceof ServerRejection) throw err;
        offline = true; // network error, CORS failure or cold-start timeout
      } finally {
        clearTimeout(timer);
      }

      if (!result && offline) {
        setStep("Backend unavailable. Compiling in your browser");
        result = await buildManifestInBrowser(pdfFile, name);
      }
      onManifestIngested?.(result.manifest, result.chunks);
      setSummary({
        brand: result.manifest.brand_name,
        version: result.manifest.version,
        terms: result.manifest.banned_terms.length,
        rules: result.manifest.voice_rules.length,
        facts: result.manifest.fact_ledger.length,
        colors: result.manifest.approved_hex_palette.length,
        chunks: result.chunks.length,
        compiledBy: result.compiledBy,
      });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong while compiling the manifest.");
      setPhase("error");
    }
  };

  const submit = () => {
    if (!file || !brandName.trim() || working) return;
    run(file, brandName.trim());
  };

  const loadSample = () => {
    if (working) return;
    const name = brandName.trim() || SAMPLE_BRAND;
    const sample = buildSampleFile(name);
    setBrandName(name);
    setFile(sample);
    run(sample, name);
  };

  const reset = () => {
    setFile(null);
    setBrandName("");
    setSummary(null);
    setError("");
    setPhase("idle");
  };

  const canSubmit = !!file && !!brandName.trim() && !working;

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
        aria-labelledby="pdf-ingest-title"
        className="modal-rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-[#0F172A] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <h2 id="pdf-ingest-title" className="text-lg font-semibold tracking-tight text-slate-100">
              Ingest brand guidelines
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Upload a brand PDF and Bastion compiles it into a manifest with searchable chunks.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        {phase === "done" && summary ? (
          <div className="space-y-5 px-6 pb-6 pt-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex items-center gap-2 text-emerald-300">
                <Check className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {summary.brand} v{summary.version} is ready
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
                {[
                  ["Banned terms", summary.terms],
                  ["Voice rules", summary.rules],
                  ["Facts", summary.facts],
                  ["Colors", summary.colors],
                  ["RAG chunks", summary.chunks],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dd className="font-mono text-xl text-slate-100">{value}</dd>
                    <dt className="mt-0.5 text-xs text-slate-400">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
            <p className={`text-sm leading-relaxed ${summary.compiledBy === "offline-starter" ? "text-amber-300" : "text-slate-400"}`}>
              {SOURCE_LABEL[summary.compiledBy] || "Manifest compiled."}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={reset} className="rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 hover:text-slate-100">
                Ingest another
              </button>
              <button onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-6 pb-6 pt-4">
            <div
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!working) pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => !working && inputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !working) {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Choose a PDF to upload"
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-9 text-center transition-colors ${
                dragOver ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-[#090D16] hover:border-slate-500"
              }`}
            >
              {file ? (
                <>
                  <FileText className="h-7 w-7 text-indigo-300" />
                  <p className="mt-3 text-sm font-medium text-slate-100">{file.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{formatSize(file.size)}. Click to choose a different file.</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-7 w-7 text-slate-400" />
                  <p className="mt-3 text-sm text-slate-200">Drop a PDF here, or click to browse</p>
                  <p className="mt-0.5 text-xs text-slate-500">Up to 15 MB. Text-based PDFs work best.</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <div>
              <label htmlFor="pdf-brand-name" className="mb-1.5 block text-sm text-slate-300">
                Brand name
              </label>
              <input
                id="pdf-brand-name"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                maxLength={80}
                placeholder="For example: Aurora Pay"
                disabled={working}
                className="w-full rounded-lg border border-slate-800 bg-[#090D16] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              />
            </div>

            {(working || phase === "error") && (
              <div
                role="status"
                className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${
                  phase === "error" ? "border-red-500/30 bg-red-500/5 text-red-300" : "border-slate-800 bg-[#090D16] text-slate-300"
                }`}
              >
                {working && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-300" />}
                <span>{working ? `${step}...` : error}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                onClick={loadSample}
                disabled={working}
                className="rounded-lg border border-slate-800 px-3.5 py-2 text-sm text-slate-300 hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Load Sample Fintech PDF
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {working && <Loader2 className="h-4 w-4 animate-spin" />}
                Compile manifest
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
