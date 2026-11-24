import { useState } from "react";
import { BookOpen, FileJson, Database, Copy, Check, Search } from "lucide-react";
import { daysUntil } from "../lib.js";

export default function BrandVaultSidebar({ manifest, ragChunks = [] }) {
  const [tab, setTab] = useState("rules");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const q = query.trim().toLowerCase();
  const tone = (manifest.voice_rules || []).filter(
    (r) => r.type === "tone" && (!q || r.name?.toLowerCase().includes(q) || r.rule_id?.toLowerCase().includes(q))
  );
  const disclaimers = (manifest.voice_rules || []).filter(
    (r) => r.type === "required_disclaimer" && (!q || r.required_text?.toLowerCase().includes(q) || r.rule_id?.toLowerCase().includes(q))
  );
  const clarifications = (manifest.voice_rules || []).filter((r) => r.type === "clarification");
  const terms = (manifest.banned_terms || []).filter(
    (t) => !q || t.term?.toLowerCase().includes(q) || t.replacement?.toLowerCase().includes(q) || t.rule_id?.toLowerCase().includes(q)
  );
  const facts = (manifest.fact_ledger || []).filter(
    (f) => !q || f.approved_statement?.toLowerCase().includes(q) || f.claim_id?.toLowerCase().includes(q)
  );

  const json = JSON.stringify(manifest, null, 2);
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <aside className="flex min-h-0 flex-col border-b border-slate-800/90 bg-[#0B101B] lg:border-b-0 lg:border-r select-none">
      <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900/90 p-1 border border-slate-800/90 text-xs">
          {[
            ["rules", "Rules", BookOpen],
            ["rag", `RAG (${ragChunks.length})`, Database],
            ["json", "JSON", FileJson],
          ].map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
                tab === id ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {tab === "rules" && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter rules, terms, facts..."
              className="w-full bg-slate-900/80 border border-slate-800 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
        {tab === "json" ? (
          <div className="relative">
            <button
              onClick={copyJson}
              className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <pre className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 pt-10 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto select-text">
              {json}
            </pre>
          </div>
        ) : tab === "rag" ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              Indexed passages extracted from the uploaded brand book PDF.
            </p>
            {ragChunks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500 leading-relaxed">
                No custom PDF uploaded yet. Click <strong className="text-slate-300">Ingest PDF</strong> in the top bar to index a brand book.
              </div>
            ) : (
              ragChunks.map((chunk, i) => (
                <div
                  key={chunk.chunk_id || i}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-indigo-300">
                    <span>{chunk.chunk_id || `RAG-${i + 1}`}</span>
                    <span className="text-slate-500">Page {chunk.page || 1}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{chunk.text}</p>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-slate-400">Approved Palette</h3>
                <span className="font-mono text-[11px] text-slate-500">≥ {manifest.wcag_min_ratio}:1</span>
              </div>
              <div className="flex items-center gap-1.5">
                {(manifest.approved_hex_palette || []).map((hex) => (
                  <div key={hex} className="flex-1 text-center">
                    <div
                      className="h-7 w-full rounded-lg ring-1 ring-inset ring-white/10"
                      style={{ background: hex }}
                      title={hex}
                    />
                    <span className="mt-1 block font-mono text-[9px] text-slate-500">{hex}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-4 border-t border-slate-800/80">
              <h3 className="text-xs font-medium text-slate-400 mb-2.5">Fact Ledger ({facts.length})</h3>
              <ul className="space-y-2">
                {facts.map((f) => {
                  const d = daysUntil(f.expires_at);
                  const soon = d !== null && d >= 0 && d <= 60;
                  return (
                    <li
                      key={f.claim_id}
                      className="rounded-xl border border-slate-800/90 bg-slate-900/50 p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-emerald-400 font-medium">{f.claim_id}</span>
                        <span className={`text-[10px] font-mono ${soon ? "text-amber-400" : "text-slate-500"}`}>
                          {soon ? `Exp ${d}d` : f.expires_at}
                        </span>
                      </div>
                      <p className="text-slate-200 leading-relaxed">{f.approved_statement}</p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="pt-4 border-t border-slate-800/80">
              <h3 className="text-xs font-medium text-slate-400 mb-2.5">Prohibited Lexicon ({terms.length})</h3>
              <ul className="space-y-2">
                {terms.map((t) => (
                  <li
                    key={t.rule_id}
                    className="rounded-xl border border-slate-800/90 bg-slate-900/50 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-slate-400">{t.rule_id}</span>
                      {t.amendments?.length > 0 && (
                        <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/15 px-1.5 py-0.5 rounded">
                          PR Merged
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-red-300 line-through">{t.term}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-emerald-300">{t.replacement}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pt-4 border-t border-slate-800/80">
              <h3 className="text-xs font-medium text-slate-400 mb-2.5">
                Voice & Disclaimers ({tone.length + disclaimers.length + clarifications.length})
              </h3>
              <ul className="space-y-2">
                {[...tone, ...disclaimers, ...clarifications].map((r) => (
                  <li
                    key={r.rule_id}
                    className="rounded-xl border border-slate-800/90 bg-slate-900/50 p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-indigo-300">{r.rule_id}</span>
                      <span className="text-[11px] text-slate-300 font-medium truncate">
                        {r.name || "Legal Disclaimer"}
                      </span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">{r.description || r.required_text}</p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
