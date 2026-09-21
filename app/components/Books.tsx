"use client";
import { byQuarter, reconciliation } from "@/lib/analyze";
import { inr, inrShort, num } from "@/lib/format";
import type { CleanResult, Refund } from "@/lib/types";
import { Explain, Section } from "./ui";

interface Props {
  clean: CleanResult; refunds: Refund[]; factor: number | null; setFactor: (f: number | null) => void;
  helpdeskQ: number; setHelpdeskQ: (n: number) => void;
}

export function Books({ clean, refunds, factor, setFactor, helpdeskQ, setHelpdeskQ }: Props) {
  const wf = reconciliation(clean);
  const max = Math.max(...wf.map((w) => Math.abs(w.amount)), 1);
  const quarters = byQuarter(refunds, clean);
  const fullQ = quarters.filter((q) => q.complete);
  const avgQ = fullQ.length ? fullQ.reduce((s, q) => s + q.amount, 0) / fullQ.length : 0;
  const gap = clean.rawSum - clean.cleanSum;

  return (
    <Section id="books" no="02" title="Do the books balance?" sub="Before any summary, the export itself has to be explained. Here is how the number in the file becomes the number we can defend.">
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="panel">
          <h3>From the file to the real total</h3>
          <p className="sub">Every step is a rupee amount, and the last line is what every table below uses.</p>
          <div className="wf" role="table" aria-label="Reconciliation">
            {wf.map((w) => (
              <div key={w.label} className={`wf-row ${w.kind}`} role="row">
                <div className="lab" role="cell">{w.label}<small>{w.note}</small></div>
                <div className="wf-bar" aria-hidden><i style={{ width: `${(Math.abs(w.amount) / max) * 100}%`, left: 0 }} /></div>
                <div className="num" role="cell">{w.kind === "minus" ? "−" : ""}{inr(Math.abs(w.amount))}</div>
              </div>
            ))}
          </div>
          <p className="sub" style={{ marginTop: 12 }}>
            The export overstates refunds by <b>{inrShort(gap)}</b>. Start + adjustments − end = <span className="mono">{inr(wf[0].amount + wf.slice(1, -1).reduce((s, w) => s + w.amount, 0) - wf[wf.length - 1].amount)}</span>.
          </p>
        </div>

        <div className="panel">
          <h3>Against the helpdesk&apos;s own report</h3>
          <p className="sub">Sameer says the helpdesk reports about ₹11 lakh a quarter. Edit the figure if Finance has a different one.</p>
          <label className="f" style={{ maxWidth: 240, marginBottom: 12 }}>Helpdesk quarterly figure (₹)
            <input type="number" min={0} step={10000} value={helpdeskQ} onChange={(e) => setHelpdeskQ(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Quarter</th><th className="num">Refunds (cleaned)</th><th className="num">Refunds</th><th className="num">vs report</th></tr></thead>
              <tbody>
                {quarters.map((q) => (
                  <tr key={q.quarter}>
                    <td>{q.label}{!q.complete && <span className="chip warn" style={{ marginLeft: 6 }}>partial</span>}</td>
                    <td className="num">{inr(q.amount)}</td>
                    <td className="num">{num(q.count)}</td>
                    <td className="num">{helpdeskQ ? `${q.amount >= helpdeskQ ? "+" : ""}${((q.amount / helpdeskQ - 1) * 100).toFixed(0)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {fullQ.length > 0 && <tfoot><tr><td>Average, full quarters</td><td className="num">{inr(avgQ)}</td><td /><td className="num">{helpdeskQ ? `${((avgQ / helpdeskQ - 1) * 100).toFixed(0)}%` : ""}</td></tr></tfoot>}
            </table>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            {avgQ && helpdeskQ ? (Math.abs(avgQ / helpdeskQ - 1) < 0.25
              ? "The cleaned totals sit in the same range as the helpdesk report. The crore came from the export's mixed units and repeated rows, not from real refunds."
              : "The cleaned totals do not match the helpdesk report closely. Check the legacy unit below and the report's own definition before the board sees either.") : ""}
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Legacy money unit</h3>
        <p className="sub">
          {clean.unit.note}{" "}
          {clean.unit.method === "inferred" && clean.unit.factor !== 1 && <span className="chip ok">confirmed by {clean.unit.sampleSize} order matches</span>}
          {clean.unit.method === "default" && <span className="chip warn">assumption</span>}
          {clean.unit.method === "manual" && <span className="chip acc">set by you</span>}
        </p>
        <div className="controls">
          <label className="f">Divide legacy amounts by
            <select value={factor ?? ""} onChange={(e) => setFactor(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Detect automatically (now ÷{clean.unit.factor})</option>
              <option value="1">1 (already rupees)</option>
              <option value="10">10</option>
              <option value="100">100 (paise)</option>
              <option value="1000">1,000</option>
            </select>
          </label>
        </div>
        <Explain label="Why the export looked like a crore">
          <p>The helpdesk went live on 14 September 2025. Tickets before that were migrated from Freshdesk, which stored money in a smaller unit than rupees. Added straight into one column, those rows are worth many times what they really were. Some migrated tickets were also loaded twice. Correcting both brings the total down to the same range as the helpdesk&apos;s own report.</p>
          <p>The unit is found from the data: for each legacy refund that can be matched to an order, we test which divisor makes the refund equal the order value. The divisor that fits most refunds wins, and it is only accepted when it clearly beats the others.</p>
        </Explain>
      </div>

      <div className="panel">
        <h3>What we found and fixed in the file</h3>
        <ul className="issues">
          {clean.issues.map((i, k) => (
            <li key={k}>
              <span className={`chip ${i.kind === "warn" ? "warn" : i.kind === "fix" ? "ok" : ""}`}>{i.kind === "fix" ? "fixed" : i.kind === "warn" ? "check" : "note"}</span>
              <span><b>{i.title}</b><span className="d">{i.detail}</span></span>
              <span className="num">{i.rupees ? inrShort(i.rupees) : i.count ? num(i.count) : ""}</span>
            </li>
          ))}
          {!clean.issues.length && <li><span /> <span>Nothing needed fixing.</span><span /></li>}
        </ul>
        {clean.rowsSkipped.length > 0 && (
          <Explain label={`See the ${clean.rowsSkipped.length} skipped rows`}>
            <ul>{clean.rowsSkipped.slice(0, 20).map((r) => <li key={r.row}>Row {r.row}: {r.reason}</li>)}</ul>
            {clean.rowsSkipped.length > 20 && <p className="mute">…and {clean.rowsSkipped.length - 20} more.</p>}
          </Explain>
        )}
      </div>
    </Section>
  );
}
