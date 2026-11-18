import { useState } from "react";
import { BookOpen, FileJson, Copy, Check } from "lucide-react";
import { SEVERITY, daysUntil } from "../lib.js";

function Section({ title, children }) {
  return (
    <section className="border-t border-bastion-line px-4 py-4">
      <h3 className="mb-2.5 text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function RuleBadge({ id }) {
  return <span className="rounded bg-bastion-bg px-1.5 py-0.5 font-mono text-[11px] text-bastion-muted ring-1 ring-inset ring-bastion-line">{id}</span>;
}

export default function BrandVaultSidebar({ manifest, source }) {
  const [tab, setTab] = useState("rules");
  const [copied, setCopied] = useState(false);
  const tone = manifest.voice_rules.filter((r) => r.type === "tone");
  const disclaimers = manifest.voice_rules.filter((r) => r.type === "required_disclaimer");
  const clarifications = manifest.voice_rules.filter((r) => r.type === "clarification");
  const json = JSON.stringify(manifest, null, 2);

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };

  return (
    <aside className="flex min-h-0 flex-col border-b border-bastion-line bg-bastion-bg lg:border-b-0 lg:border-r" aria-label="Brand vault">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">{manifest.brand_name}</h2>
          <span className="font-mono text-xs text-bastion-muted">v{manifest.version}</span>
        </div>
        <p className="mt-0.5 text-xs text-bastion-muted">{source === "api" ? "Loaded from the Bastion API" : "Bundled fallback manifest"}</p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-bastion-line bg-bastion-surface p-0.5" role="tablist">
          {[["rules", "Human rules", BookOpen], ["json", "BrandManifest.json", FileJson]].map(([id, label, Icon]) => (
            <button
              key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${tab === id ? "bg-bastion-bg text-bastion-text" : "text-bastion-muted hover:text-bastion-text"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "json" ? (
          <div className="relative px-4 pb-4">
            <button onClick={copy} className="absolute right-6 top-2 flex items-center gap-1 rounded-md border border-bastion-line bg-bastion-surface px-2 py-1 text-xs text-bastion-muted hover:text-bastion-text">
              {copied ? <Check className="h-3 w-3 text-bastion-ok" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <pre className="max-h-[70vh] overflow-auto rounded-lg border border-bastion-line bg-bastion-surface p-3 pt-9 font-mono text-[11px] leading-relaxed text-slate-300">{json}</pre>
          </div>
        ) : (
          <>
            <Section title="Voice">
              <ul className="space-y-3">
                {tone.map((r) => (
                  <li key={r.rule_id}>
                    <div className="flex items-center gap-2"><RuleBadge id={r.rule_id} /><span className="text-sm">{r.name}</span></div>
                    <p className="mt-1 text-xs leading-relaxed text-bastion-muted">{r.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Banned terms">
              <ul className="space-y-2.5">
                {manifest.banned_terms.map((t) => (
                  <li key={t.rule_id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RuleBadge id={t.rule_id} />
                      <span className="rounded bg-bastion-danger/10 px-1.5 py-0.5 text-red-300 line-through decoration-bastion-danger/60">{t.term}</span>
                      <span className="text-bastion-muted">becomes</span>
                      <span className="rounded bg-bastion-ok/10 px-1.5 py-0.5 text-emerald-300">{t.replacement}</span>
                    </div>
                    <div className="mt-1 text-bastion-muted">{SEVERITY[t.severity]?.label} · {t.citation}</div>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Required disclaimers">
              <ul className="space-y-3">
                {disclaimers.map((d) => (
                  <li key={d.rule_id} className="text-xs">
                    <div className="flex items-center gap-2"><RuleBadge id={d.rule_id} /><span className="text-bastion-muted">{d.citation}</span></div>
                    <p className="mt-1 leading-relaxed">“{d.required_text}”</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Approved palette">
              <div className="flex gap-2">
                {manifest.approved_hex_palette.map((hex) => (
                  <div key={hex} className="text-center">
                    <div className="h-8 w-8 rounded-md ring-1 ring-inset ring-white/15" style={{ background: hex }} title={hex} />
                    <div className="mt-1 font-mono text-[9px] text-bastion-muted">{hex.slice(1)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-bastion-muted">Text needs a {manifest.wcag_min_ratio}:1 contrast ratio.</p>
            </Section>

            <Section title="Approved fact ledger">
              <ul className="space-y-3">
                {manifest.fact_ledger.map((f) => {
                  const d = daysUntil(f.expires_at);
                  const expired = d !== null && d < 0;
                  const soon = d !== null && d >= 0 && d <= 60;
                  return (
                    <li key={f.claim_id} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <RuleBadge id={f.claim_id} />
                        <span className={`rounded px-1.5 py-0.5 ${expired ? "bg-bastion-danger/15 text-red-300" : soon ? "bg-bastion-amber/15 text-amber-300" : "text-bastion-muted"}`}>
                          {expired ? "Expired" : soon ? `Expires in ${d} days` : `Valid to ${f.expires_at}`}
                        </span>
                      </div>
                      <p className="mt-1 leading-relaxed">{f.approved_statement}</p>
                      <p className="mt-0.5 text-bastion-muted">{f.source_citation}</p>
                    </li>
                  );
                })}
              </ul>
            </Section>

            {clarifications.length > 0 && (
              <Section title="Merged guideline clarifications">
                <ul className="space-y-2 text-xs">
                  {clarifications.map((c) => (
                    <li key={c.rule_id}><RuleBadge id={c.rule_id} /><p className="mt-1 text-bastion-muted">{c.description}</p></li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
