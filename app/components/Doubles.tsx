"use client";
import { useMemo } from "react";
import { doublePayouts } from "@/lib/analyze";
import { quarterLabel } from "@/lib/csv";
import { inr, inrShort, num, pct } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import type { Refund } from "@/lib/types";
import type { DrawerSpec } from "./Drawer";
import { Explain, Section } from "./ui";

export function Doubles({ refunds, ref_, openDrawer }: { refunds: Refund[]; ref_: Reference; openDrawer: (d: DrawerSpec) => void }) {
  const dp = useMemo(() => doublePayouts(refunds, ref_), [refunds, ref_]);
  const maxQ = Math.max(...dp.byQuarter.map((q) => q.value), 1);
  const ids = refunds.filter((r) => r.doublePayout).map((r) => r.ticket_id);
  const noteOnly = refunds.filter((r) => r.doublePayout && !r.replacementFlag).map((r) => r.ticket_id);

  return (
    <Section id="doubles" no="05" title="Refund and replacement on the same ticket" sub="Policy §5: never both. Neha spot-checked twenty tickets and found a couple. This checks every one.">
      {dp.count === 0 ? (
        <div className="banner good"><b>None found.</b> No refund in this file also carries a replacement flag or a note saying a new unit was sent.</div>
      ) : (
        <>
          <div className="grid3">
            <div className="panel"><div className="eyebrow">Customers paid twice</div><div className="bignum" style={{ fontSize: 44 }}>{num(dp.count)}</div><p className="sub" style={{ margin: 0 }}>{pct(dp.shareOfRefunds, 1)} of all refunds.</p></div>
            <div className="panel"><div className="eyebrow">Cost</div><div className="bignum" style={{ fontSize: 44 }}>{inrShort(dp.total)}</div><p className="sub" style={{ margin: 0 }}>{inrShort(dp.refundValue)} refunded + {inrShort(dp.replacementValue)} of units and shipping.</p></div>
            <div className="panel"><div className="eyebrow">Hidden from the flag</div><div className="bignum" style={{ fontSize: 44 }}>{num(dp.flaggedByNoteOnly)}</div><p className="sub" style={{ margin: 0 }}>Agent never ticked “replacement issued”, but the note says a new unit went out. A flag-only report misses these.</p></div>
          </div>

          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="panel">
              <h3>Per quarter</h3>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {dp.byQuarter.map((q) => (
                  <div key={q.quarter} style={{ display: "grid", gridTemplateColumns: "88px 1fr 110px", gap: 10, alignItems: "center", fontSize: 13.5 }}>
                    <span>{quarterLabel(q.quarter)}</span>
                    <div className="meter"><i style={{ width: `${(q.value / maxQ) * 100}%` }} /></div>
                    <span className="num">{inr(q.value)} · {q.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <h3>Who resolved them</h3>
              <div className="tablewrap"><table>
                <thead><tr><th>Agent</th><th>Team</th><th className="num">Cases</th><th className="num">Cost</th></tr></thead>
                <tbody>{dp.byAgent.slice(0, 8).map((a) => (
                  <tr key={a.agent_id}>
                    <td><button className="link" onClick={() => openDrawer({ title: `${a.name}: refund + replacement`, ids: refunds.filter((r) => r.doublePayout && r.agent_id === a.agent_id).map((r) => r.ticket_id) })}>{a.name}</button></td>
                    <td>{a.team}</td><td className="num">{a.count}</td><td className="num">{inr(a.value)}</td>
                  </tr>))}</tbody>
              </table></div>
              {dp.byAgent.length > 8 && <p className="sub" style={{ marginTop: 8 }}>{dp.byAgent.length - 8} more in the workbook.</p>}
            </div>
          </div>

          <div className="panel">
            <h3>What to do</h3>
            <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              <li>Send the list of {num(dp.count)} tickets to the Team Leads and Finance. Policy already requires same-day escalation.</li>
              <li>Add a hard stop in the helpdesk: block “replacement issued = Y” when a refund amount is present on the same ticket.</li>
              <li>Agree whether the customers already paid twice are worth recovering. That is a business call, not one this tool makes.</li>
            </ol>
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn accent small" onClick={() => openDrawer({ title: "Refund + replacement", sub: "Both a refund and a new unit.", ids })}>Open all {num(dp.count)} tickets</button>
              {noteOnly.length > 0 && <button className="btn ghost small" onClick={() => openDrawer({ title: "Found only in notes", sub: "Replacement flag not ticked.", ids: noteOnly })}>Only in the notes ({num(noteOnly.length)})</button>}
            </div>
          </div>
        </>
      )}
      <Explain>
        <p>A refund counts as a double payout when the amount is positive and either the “replacement issued” flag is Y, or the agent&apos;s note says a new unit was sent (“also sent a new unit”, “replacement dispatched”). Notes that say the customer <i>chose a refund over a replacement</i> are deliberately not counted. Replacement cost is the product&apos;s unit cost plus ₹340 for pickup and shipping, with no refurbishment credit, as policy §5 says to plan.</p>
        <p>Limit: the file has one order per ticket at best, so a genuine second order by the same customer flagged “replacement” would be counted as a double payout. Open the tickets and check before acting on any single case.</p>
      </Explain>
    </Section>
  );
}
