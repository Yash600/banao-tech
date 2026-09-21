"use client";
import { useMemo, useState } from "react";
import { inr, num, pct } from "@/lib/format";
import type { Progress } from "@/lib/classify";
import type { CorrectedCode, Refund } from "@/lib/types";
import { REASON_CODES, REASON_LABEL } from "@/lib/types";
import type { DrawerSpec } from "./Drawer";
import { CodeChip, Explain, Section, download, toCsv } from "./ui";

export interface Truth { ticket_id: string; true_reason: string; agent_code: string; double_payout: string; true_refund_inr: string }

const SRC: Record<Refund["codeSource"], string> = { rules: "Keyword rules (clear)", llm: "AI reading", "rules-fallback": "Keyword rules (weak)", manual: "Human correction" };

/** Wilson 95% interval: honest about how little a small sample proves. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

function shuffle<T>(a: T[], seed: number): T[] {
  const r = [...a]; let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export function Trust({ refunds, truth, openDrawer, setManual, flash, progress }: {
  refunds: Refund[]; truth: Record<string, Truth> | null; openDrawer: (d: DrawerSpec) => void;
  setManual: (id: string, c: CorrectedCode) => void; flash: (m: string) => void; progress: Progress | null;
}) {
  const bySrc = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of refunds) m.set(r.code === "UNCLEAR" ? "Unclear (not guessed)" : SRC[r.codeSource], (m.get(r.code === "UNCLEAR" ? "Unclear (not guessed)" : SRC[r.codeSource]) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [refunds]);

  return (
    <Section id="trust" no="07" title="How far to trust this" sub="A tool that reads free text will sometimes be wrong. Here is how wrong, measured, and how you can measure it yourself on your own data.">
      <div className="panel">
        <h3>How each reason was decided</h3>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {bySrc.map(([label, n]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "200px 1fr 90px", gap: 10, alignItems: "center", fontSize: 14 }}>
              <span>{label}</span><div className="meter"><i style={{ width: `${(n / refunds.length) * 100}%` }} /></div><span className="num">{num(n)} · {pct(n / refunds.length)}</span>
            </div>
          ))}
        </div>
        {progress?.state === "done" && <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>AI run: {num(progress.calls)} calls, {num(progress.tokens)} tokens on Groq&apos;s free tier, so ₹0.</p>}
      </div>

      {truth ? <Measured refunds={refunds} truth={truth} openDrawer={openDrawer} /> : (
        <div className="banner" role="note">A real export has no answer key, so accuracy cannot be computed against one. Use the spot-check below: it works on any data and gives the error rate that matters.</div>
      )}

      <SpotCheck refunds={refunds} setManual={setManual} flash={flash} />

      <div className="panel">
        <h3>What is known to be off</h3>
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li><b>Reason codes have no answer key on real data.</b> The real export does not say what the true reason was, so accuracy cannot be computed from it. The keyword rules and the AI are checked indirectly (agreement with agents&apos; specific codes) and by the spot-check above, which is the only real error rate. On the synthetic sample the accuracy figure flatters the rules, since the same person wrote the notes and the rules.</li>
          <li><b>Legacy unit is inferred.</b> It is found by matching refunds to order values. If too few legacy refunds match an order the tool says so and falls back to paise, and you should confirm with Finance.</li>
          <li><b>Duplicate detection uses ticket_id only.</b> Two different tickets about the same order are not merged.</li>
          <li><b>The refund date is the ticket creation date.</b> The export has no “refund issued” date, so a refund raised a month after the ticket is placed in the earlier month.</li>
          <li><b>The agent is the resolver.</b> That may not be whoever approved the money.</li>
          <li><b>Refund + replacement can over-count</b> when a customer legitimately got a replacement for a different order, since the file gives no link between the two.</li>
          <li><b>The AI can be wrong or invent evidence.</b> Its answers are checked against the allowed codes, but a fluent wrong answer is still possible. Spot-check before quoting a number to the board.</li>
        </ul>
      </div>
    </Section>
  );
}

function Measured({ refunds, truth, openDrawer }: { refunds: Refund[]; truth: Record<string, Truth>; openDrawer: (d: DrawerSpec) => void }) {
  const m = useMemo(() => {
    const rows = refunds.filter((r) => truth[r.ticket_id]?.true_reason);
    let right = 0, wrong = 0, unclear = 0, agentRight = 0, wrongAmt = 0, tot = 0;
    const per: Record<string, { tp: number; fp: number; fn: number }> = {};
    const conf = new Map<string, { n: number; ids: string[] }>();
    const bySource: Record<string, { n: number; ok: number }> = {};
    for (const c of REASON_CODES) per[c] = { tp: 0, fp: 0, fn: 0 };
    for (const r of rows) {
      const t = truth[r.ticket_id].true_reason;
      tot += r.amount;
      if (r.reportedCode === t) agentRight++;
      const s = (bySource[r.codeSource] ||= { n: 0, ok: 0 });
      if (r.code === "UNCLEAR") { unclear++; per[t].fn++; continue; }
      s.n++;
      if (r.code === t) { right++; s.ok++; per[t].tp++; } else {
        wrong++; wrongAmt += r.amount; per[t].fn++; per[r.code].fp++;
        const k = `${t} → ${r.code}`; const e = conf.get(k) ?? { n: 0, ids: [] }; e.n++; e.ids.push(r.ticket_id); conf.set(k, e);
      }
    }
    let tp = 0, fp = 0, fn = 0;
    for (const r of refunds) { const d = truth[r.ticket_id]?.double_payout === "Y"; if (r.doublePayout && d) tp++; else if (r.doublePayout) fp++; else if (d) fn++; }
    return { n: rows.length, right, wrong, unclear, agentRight, wrongAmt, tot, per, conf: [...conf].sort((a, b) => b[1].n - a[1].n).slice(0, 6), bySource, tp, fp, fn };
  }, [refunds, truth]);
  const [lo, hi] = wilson(m.wrong, m.right + m.wrong);
  const truthSum = Object.values(truth).reduce((s, r) => s + (Number(r.true_refund_inr) || 0), 0);
  const cleanSum = refunds.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="panel">
      <h3>Measured against the answer key</h3>
      <p className="sub">The synthetic sample comes with the true reason for every ticket, hidden from the tool. {num(m.n)} refunds compared.</p>
      <div className="grid3">
        <Stat label="Reason correct" v={pct(m.right / m.n, 1)} sub={`${num(m.right)} of ${num(m.n)}`} />
        <Stat label="Reason wrong" v={pct(m.wrong / m.n, 1)} sub={`${num(m.wrong)} · 95% range ${pct(lo, 1)}–${pct(hi, 1)} of the ones it committed to`} />
        <Stat label="Left as unclear" v={pct(m.unclear / m.n, 1)} sub={`${num(m.unclear)} · not guessed`} />
      </div>
      <div className="grid3" style={{ marginTop: 16 }}>
        <Stat label="Agents' own dropdown correct" v={pct(m.agentRight / m.n, 1)} sub="the baseline we improve on" />
        <Stat label="Rupees under a wrong code" v={inr(m.wrongAmt)} sub={`${pct(m.wrongAmt / (m.tot || 1), 2)} of refund value`} />
        <Stat label="Total vs the true total" v={inr(cleanSum - truthSum)} sub={`cleaned ${inr(cleanSum)} · true ${inr(truthSum)}`} />
      </div>
      <p style={{ marginTop: 14 }}><b>Refund + replacement:</b> found {m.tp}, false alarms {m.fp}, missed {m.fn} (recall {pct(m.tp / Math.max(m.tp + m.fn, 1), 1)}). Misses are cases where neither the flag nor the note mention a new unit.</p>

      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Reason</th><th className="num">Precision</th><th className="num">Recall</th><th className="num">Cases</th></tr></thead>
          <tbody>{REASON_CODES.map((c) => { const p = m.per[c]; return (
            <tr key={c}><td><CodeChip code={c} /> {REASON_LABEL[c]}</td>
              <td className="num">{p.tp + p.fp ? pct(p.tp / (p.tp + p.fp), 0) : "—"}</td><td className="num">{p.tp + p.fn ? pct(p.tp / (p.tp + p.fn), 0) : "—"}</td><td className="num">{p.tp + p.fn}</td></tr>); })}</tbody>
        </table>
      </div>
      {m.conf.length > 0 ? (
        <p style={{ marginTop: 12 }}><b>The kinds of case it gets wrong:</b>{" "}
          {m.conf.map(([k, v]) => <button key={k} className="link" style={{ marginRight: 12 }} onClick={() => openDrawer({ title: k, sub: "True reason → what the tool said.", ids: v.ids })}>{k} ({v.n})</button>)}
        </p>
      ) : <p style={{ marginTop: 12 }}><b>Kinds of error:</b> none among the refunds it committed to; every miss is a refund it left as unclear. That is by design, but it is also a sign the synthetic wording is easy for the rules. Real notes will be messier.</p>}
      <Explain label="Read this before quoting the numbers">
        <p>These figures come from data I generated, using wording I chose, to test rules I also wrote. That makes them optimistic. What they do prove is the mechanics: unit fix, duplicate removal and the totals reconcile to the rupee, and unclear notes are refused rather than guessed. What they cannot prove is accuracy on Vireo&apos;s real notes. For that, use the spot-check below on the real export.</p>
      </Explain>
    </div>
  );
}

function Stat({ label, v, sub }: { label: string; v: string; sub: string }) {
  return <div className="panel" style={{ margin: 0 }}><div className="eyebrow">{label}</div><div className="bignum" style={{ fontSize: 34, color: "var(--ink)" }}>{v}</div><p className="sub" style={{ margin: "6px 0 0" }}>{sub}</p></div>;
}

function SpotCheck({ refunds, setManual, flash }: { refunds: Refund[]; setManual: (id: string, c: CorrectedCode) => void; flash: (m: string) => void }) {
  const [n, setN] = useState(30);
  const [seed, setSeed] = useState(7);
  const [verdicts, setVerdicts] = useState<Record<string, "ok" | "bad" | "skip">>({});
  const sample = useMemo(() => shuffle(refunds, seed).slice(0, Math.min(n, refunds.length)), [refunds, seed, n]);
  const judged = sample.filter((r) => verdicts[r.ticket_id] === "ok" || verdicts[r.ticket_id] === "bad");
  const bad = judged.filter((r) => verdicts[r.ticket_id] === "bad").length;
  const [lo, hi] = wilson(bad, judged.length);
  const mark = (id: string, v: "ok" | "bad" | "skip") => setVerdicts((s) => ({ ...s, [id]: v }));

  const exportIt = () => download(new Blob([toCsv([["ticket_id", "tool_code", "how", "verdict", "agent_note"], ...sample.map((r) => [r.ticket_id, r.code, SRC[r.codeSource], verdicts[r.ticket_id] ?? "", r.note])])], { type: "text/csv" }), "spot-check.csv");

  return (
    <div className="panel">
      <h3>Spot-check it yourself</h3>
      <p className="sub">Draw a random sample, read each note, and mark whether the tool&apos;s reason is right. Thirty tickets takes about ten minutes and tells you far more than this page can.</p>
      <div className="controls">
        <label className="f">Sample size<input type="number" min={5} max={200} value={n} onChange={(e) => { setN(Math.max(5, Math.min(200, Number(e.target.value) || 30))); }} style={{ width: 90 }} /></label>
        <button className="btn ghost small" style={{ alignSelf: "end" }} onClick={() => { setSeed((s) => s + 1); setVerdicts({}); }}>Draw a new sample</button>
        <button className="btn ghost small" style={{ alignSelf: "end" }} onClick={exportIt}>Download results</button>
      </div>
      <div className="banner good" role="status" style={{ margin: "0 0 12px" }}>
        {judged.length ? <><b>{bad} wrong of {judged.length} checked</b> · error rate {pct(bad / judged.length, 0)} (95% range {pct(lo, 0)}–{pct(hi, 0)}). {judged.length < 30 ? "Check at least 30 for a range worth quoting." : ""}</> : <>Nothing checked yet.</>}
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto", display: "grid", gap: 10 }}>
        {sample.map((r) => {
          const v = verdicts[r.ticket_id];
          return (
            <article key={r.ticket_id} className="tk" style={{ margin: 0, opacity: v === "skip" ? 0.5 : 1 }}>
              <div className="meta"><b className="mono">{r.ticket_id}</b><span>{inr(r.amount)}</span><span className="mute">tool says</span><CodeChip code={r.code} /><span className="chip">{SRC[r.codeSource]}</span><span className="mute">agent coded</span><CodeChip code={r.reportedCode || "(blank)"} /></div>
              {r.message && <blockquote><small>Customer</small>{r.message}</blockquote>}
              <blockquote><small>Agent note</small>{r.note || <span className="mute">(blank)</span>}</blockquote>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn small ghost" aria-pressed={v === "ok"} style={v === "ok" ? { background: "var(--ok-wash)", borderColor: "var(--ok)" } : {}} onClick={() => mark(r.ticket_id, "ok")}>Right</button>
                <button className="btn small ghost" aria-pressed={v === "bad"} style={v === "bad" ? { background: "var(--accent-wash)", borderColor: "var(--accent)" } : {}} onClick={() => mark(r.ticket_id, "bad")}>Wrong</button>
                <button className="btn small ghost" onClick={() => mark(r.ticket_id, "skip")}>Can&apos;t tell</button>
                {v === "bad" && (
                  <select aria-label="Correct reason" defaultValue="" onChange={(e) => { if (e.target.value) { setManual(r.ticket_id, e.target.value as CorrectedCode); flash("Correction saved and applied to the totals."); } }}>
                    <option value="">Set the right reason…</option>
                    {[...REASON_CODES, "UNCLEAR"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
