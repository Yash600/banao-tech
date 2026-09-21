"use client";
import { useMemo } from "react";
import { badLots, doublePayouts, q4Test } from "@/lib/analyze";
import { inr, inrShort, num, pct } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import type { CleanResult, Refund } from "@/lib/types";
import type { DrawerSpec } from "./Drawer";
import { Explain, Section } from "./ui";

export function Claims({ clean, refunds, ref_, openDrawer }: { clean: CleanResult; refunds: Refund[]; ref_: Reference; openDrawer: (d: DrawerSpec) => void }) {
  const q = useMemo(() => q4Test(refunds, clean), [refunds, clean]);
  const dp = useMemo(() => doublePayouts(refunds, ref_), [refunds, ref_]);
  const lots = useMemo(() => badLots(refunds, ref_), [refunds, ref_]);

  const teamShare = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const r of refunds) { const x = m.get(r.team) ?? { amount: 0, count: 0 }; x.amount += r.amount; x.count++; m.set(r.team, x); }
    const total = refunds.reduce((s, r) => s + r.amount, 0) || 1;
    return [...m].map(([team, v]) => ({ team, ...v, share: v.amount / total })).sort((a, b) => b.amount - a.amount);
  }, [refunds]);
  const returnsShare = teamShare.find((t) => t.team === "Returns Desk")?.share ?? 0;
  const returnsDoubles = refunds.filter((r) => r.doublePayout && r.team === "Returns Desk").length;
  const returnsCountShare = refunds.length ? refunds.filter((r) => r.team === "Returns Desk").length / refunds.length : 0;
  const doubleByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of refunds) if (r.doublePayout) m.set(r.team, (m.get(r.team) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [refunds]);
  const topDoubleTeam = doubleByTeam[0];

  const overCap = refunds.filter((r) => r.capBreach);
  const overAmt = overCap.reduce((s, r) => s + (r.amount - 500), 0);
  const nQ = q.rows.length;

  return (
    <Section id="claims" no="06" title="Testing the stories in the email thread" sub="Each person in the thread offered an explanation. Here is what the file says about each.">
      <div className="panel">
        <div className="eyebrow">Priya · Head of CX</div>
        <h3>“Refunds went up because we told the frontline to stop arguing. CSAT rose 0.4.”</h3>
        {nQ < 2 ? <p className="mute">Not enough quarters in this file.</p> : (
          <>
            <div className="tablewrap" style={{ margin: "10px 0" }}>
              <table>
                <thead><tr><th>Quarter</th><th className="num">Frontline</th><th className="num">Returns Desk</th><th className="num">Other teams</th><th className="num">Total</th><th className="num">CSAT (responders)</th><th className="num">Coded goodwill</th></tr></thead>
                <tbody>{q.rows.map((r) => (
                  <tr key={r.quarter}><td>{r.label}</td><td className="num">{inr(r.frontline)}</td><td className="num">{inr(r.returns)}</td><td className="num">{inr(r.other)}</td><td className="num"><b>{inr(r.total)}</b></td>
                    <td className="num">{r.csat != null ? r.csat.toFixed(2) : "—"} <span className="mute">n={num(r.csatN)}</span></td><td className="num">{num(r.gwCoded)}</td></tr>))}</tbody>
              </table>
            </div>
            <p style={{ marginBottom: 6 }}><b>What the file says.</b> {q.verdict}</p>
            {q.csatDelta != null && (
              <p style={{ marginBottom: 6 }}>
                <b>On “CSAT went up 0.4”:</b>{" "}
                {Math.max(q.csatDelta, q.csatVsPrior ?? -9) >= 0.3
                  ? "the file supports a rise of about that size."
                  : `the file shows nothing like +0.4 (${q.csatDelta >= 0 ? "+" : ""}${q.csatDelta.toFixed(2)} on the previous quarter${q.csatVsPrior != null ? `, ${q.csatVsPrior >= 0 ? "+" : ""}${q.csatVsPrior.toFixed(2)} on earlier quarters` : ""}). The 0.4 may come from a different period or definition, so ask Priya where it is measured.`}
              </p>
            )}
            {q.frontlineShareOfRise != null && (
              <p className="mute" style={{ margin: 0 }}>
                {q.frontlineShareOfRise < 0.5
                  ? "So the frontline policy explains only part of the rise. The larger share came from elsewhere, and that is where to look first."
                  : "The frontline does account for most of the rise, which supports the explanation. Whether that was worth it depends on what the extra goodwill bought."}
              </p>
            )}
          </>
        )}
        <Explain label="Caveats"><p>CSAT is averaged only over customers who answered (about 45%), and blanks are excluded, never counted as zero. A CSAT change can also come from who chose to respond, so treat it as a hint rather than proof of cause.</p></Explain>
      </div>

      <div className="panel">
        <div className="eyebrow">Neha · Support Operations</div>
        <h3>“The Returns Desk is very careful, and does most of the refunds.”</h3>
        <p style={{ marginBottom: 6 }}>
          The Returns Desk resolves <b>{pct(returnsShare)}</b> of refund rupees ({pct(returnsCountShare)} of refunds). {returnsShare >= 0.5
            ? "That matches “most”."
            : <>That is <b>not</b> “most”. Policy §6 says the Returns Desk processes the large majority of refunds, but here {pct(1 - returnsCountShare)} of refunds were resolved by other teams.</>}{" "}
          Of the {num(dp.count)} refund-plus-replacement cases, only <b>{num(returnsDoubles)}</b> ({pct(returnsDoubles / Math.max(dp.count, 1))}) were resolved by the Returns Desk.
          {returnsDoubles / Math.max(dp.count, 1) > 0.5 ? " Most double payouts are theirs, so “a couple of one-offs” undersells it." : topDoubleTeam ? ` The most are with ${topDoubleTeam[0]} (${num(topDoubleTeam[1])}).` : ""}
        </p>
        <div className="tablewrap"><table>
          <thead><tr><th>Team</th><th className="num">Refunds</th><th className="num">Rupees</th><th className="num">Share</th></tr></thead>
          <tbody>{teamShare.map((t) => <tr key={t.team}><td>{t.team}</td><td className="num">{num(t.count)}</td><td className="num">{inr(t.amount)}</td><td className="num">{pct(t.share)}</td></tr>)}</tbody>
        </table></div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="eyebrow">Policy §5 · goodwill cap</div>
          <h3>Goodwill credits are capped at ₹500</h3>
          {overCap.length ? (
            <>
              <p><b>{num(overCap.length)}</b> refunds read as goodwill exceed ₹500, together <b>{inrShort(overAmt)}</b> above the cap. The cap needs Team Lead approval; the file cannot show whether that was given.</p>
              <button className="btn ghost small" onClick={() => openDrawer({ title: "Goodwill above ₹500", ids: overCap.map((r) => r.ticket_id) })}>See the tickets</button>
            </>
          ) : <p className="mute">No goodwill refund exceeds ₹500 in this file.</p>}
        </div>
        <div className="panel">
          <div className="eyebrow">Something nobody asked about</div>
          <h3>Manufacturing lots with unusual returns</h3>
          {lots.lots.length ? (
            <>
              <p className="sub">Refund rate against orders in the lot, normal ≈ {pct(lots.baseline, 0)}. Lots at twice that with mostly dead-on-arrival reasons:</p>
              <div className="tablewrap"><table>
                <thead><tr><th>Lot</th><th className="num">Orders</th><th className="num">Refunds</th><th className="num">Rate</th></tr></thead>
                <tbody>{lots.lots.map((l) => (
                  <tr key={l.lot}><td className="mono">{l.lot}</td><td className="num">{l.orders}</td><td className="num">{l.refunds}</td><td className="num">{pct(l.rate)}</td></tr>))}</tbody>
              </table></div>
              <p className="sub" style={{ marginTop: 8 }}>If these are dead-on-arrival units, that is a supplier problem, not a support one. Worth raising with Operations.</p>
            </>
          ) : <p className="mute">No lot stands out.</p>}
        </div>
      </div>
    </Section>
  );
}
