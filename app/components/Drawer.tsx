"use client";
import { useEffect, useMemo, useState } from "react";
import { inr } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import type { CorrectedCode, Refund } from "@/lib/types";
import { REASON_CODES, REASON_LABEL } from "@/lib/types";
import { CodeChip, download, toCsv } from "./ui";

export interface DrawerSpec { title: string; sub?: string; ids: string[] }

const SOURCE_LABEL: Record<Refund["codeSource"], string> = { rules: "keyword rule", llm: "AI reading", "rules-fallback": "weak rule", manual: "reviewer" };
const PAGE = 40;

export function Drawer({ spec, refunds, ref_, onClose, setManual }: {
  spec: DrawerSpec; refunds: Refund[]; ref_: Reference | null; onClose: () => void; setManual: (id: string, c: CorrectedCode) => void;
}) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const byId = useMemo(() => new Map(refunds.map((r) => [r.ticket_id, r])), [refunds]);
  const list = useMemo(() => spec.ids.map((i) => byId.get(i)).filter(Boolean) as Refund[], [spec.ids, byId]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((r) => (r.ticket_id + " " + r.note + " " + r.message + " " + r.agent_id + " " + r.code + " " + r.reportedCode).toLowerCase().includes(s));
  }, [list, q]);
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  const exportCsv = () => download(new Blob([toCsv([
    ["ticket_id", "month", "agent_id", "amount_inr", "agent_coded", "corrected", "how", "evidence", "customer_message", "agent_note"],
    ...filtered.map((r) => [r.ticket_id, r.month, r.agent_id, Math.round(r.amount), r.reportedCode, r.code, SOURCE_LABEL[r.codeSource], r.evidence, r.message, r.note]),
  ])], { type: "text/csv" }), `tickets-${spec.title.replace(/\W+/g, "-").toLowerCase()}.csv`);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={spec.title}>
        <header>
          <div>
            <h3 style={{ fontSize: 22 }}>{spec.title}</h3>
            <div className="mute" style={{ fontSize: 13.5 }}>{spec.sub} {list.length.toLocaleString("en-IN")} tickets · <span className="mono">{inr(total)}</span></div>
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">Close ✕</button>
        </header>
        <div className="body">
          <div className="controls">
            <input type="search" placeholder="Search notes, ticket, agent…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} style={{ flex: 1, minWidth: 180 }} aria-label="Search tickets" />
            <button className="btn ghost small" onClick={exportCsv} disabled={!filtered.length}>Download CSV</button>
          </div>
          {!filtered.length && <p className="mute">No tickets match.</p>}
          {filtered.slice(0, shown).map((r) => (
            <article key={r.ticket_id} className="tk">
              <div className="meta">
                <b className="mono">{r.ticket_id}</b>
                <span>{r.month}</span>
                <span>{ref_?.agents[r.agent_id]?.name ?? r.agent_id} <span className="mute">({r.team})</span></span>
                <b className="mono" style={{ marginLeft: "auto" }}>{inr(r.amount)}</b>
              </div>
              <div className="meta">
                <span className="mute">Agent coded</span> <CodeChip code={r.reportedCode || "(blank)"} />
                <span className="mute">→ reads as</span> <CodeChip code={r.code} />
                <span className="chip">{SOURCE_LABEL[r.codeSource]}</span>
                {r.doublePayout && <span className="chip acc">also got a replacement</span>}
                {r.capBreach && <span className="chip warn">goodwill over ₹500</span>}
              </div>
              {r.evidence && <div className="mute" style={{ fontSize: 12.5 }}>Evidence: {r.evidence}</div>}
              {r.message && <blockquote><small>Customer</small>{r.message}</blockquote>}
              <blockquote><small>Agent note</small>{r.note || <span className="mute">(blank)</span>}</blockquote>
              <label className="f" style={{ maxWidth: 260, marginTop: 6 }}>Correct the reason
                <select value={r.code} onChange={(e) => setManual(r.ticket_id, e.target.value as CorrectedCode)}>
                  {[...REASON_CODES, "UNCLEAR"].map((c) => <option key={c} value={c}>{c} · {REASON_LABEL[c as CorrectedCode]}</option>)}
                </select>
              </label>
            </article>
          ))}
          {filtered.length > shown && <button className="btn ghost" onClick={() => setShown((s) => s + PAGE * 2)}>Show more ({filtered.length - shown} left)</button>}
        </div>
      </aside>
    </>
  );
}
