"use client";
import { useMemo, useState } from "react";
import { byAgent, monthsOf } from "@/lib/analyze";
import { inr, inrShort, monthLabel, num, pct } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import type { CleanResult, Refund } from "@/lib/types";
import type { DrawerSpec } from "./Drawer";
import { Explain, Section, SortHead, download, toCsv } from "./ui";

export function Agents({ clean, refunds, ref_, openDrawer }: { clean: CleanResult; refunds: Refund[]; ref_: Reference; openDrawer: (d: DrawerSpec) => void }) {
  const [view, setView] = useState<"summary" | "months">("summary");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "amount", dir: -1 });

  const rows = useMemo(() => byAgent(refunds, ref_), [refunds, ref_]);
  const months = useMemo(() => monthsOf(refunds), [refunds]);

  // refund rate = refunds per 100 tickets the agent resolved. Team-fair, unlike raw rupees.
  const handled = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of clean.allTickets) m.set(t.agent_id, (m.get(t.agent_id) ?? 0) + 1);
    return m;
  }, [clean]);
  const withRate = useMemo(() => rows.map((a) => ({ ...a, tickets: handled.get(a.agent_id) ?? 0, rate: (handled.get(a.agent_id) ?? 0) ? a.count / (handled.get(a.agent_id) ?? 1) : 0, gwShare: a.count ? a.gwReported / a.count : 0 })), [rows, handled]);
  const teamRate = useMemo(() => {
    const t = new Map<string, { r: number; n: number }>();
    for (const a of withRate) { const x = t.get(a.team) ?? { r: 0, n: 0 }; x.r += a.count; x.n += a.tickets; t.set(a.team, x); }
    return new Map([...t].map(([k, v]) => [k, v.n ? v.r / v.n : 0]));
  }, [withRate]);

  const teams = [...new Set(rows.map((r) => r.team))].sort();
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const f = withRate.filter((a) => (team === "all" || a.team === team) && (!s || (a.name + a.agent_id + a.team).toLowerCase().includes(s)));
    const val = (a: (typeof f)[number]): number | string => {
      switch (sort.k) {
        case "name": return a.name; case "team": return a.team; case "count": return a.count; case "avg": return a.avg; case "rate": return a.rate;
        case "gw": return a.gwShare; case "dbl": return a.doubles; case "cap": return a.capBreaches; default: return a.amount;
      }
    };
    return [...f].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir; });
  }, [withRate, team, q, sort]);
  const total = list.reduce((s, a) => s + a.amount, 0);

  const teamTable = useMemo(() => {
    const t = new Map<string, { team: string; amount: number; count: number; agents: number; doubles: number }>();
    for (const a of withRate) {
      const x = t.get(a.team) ?? { team: a.team, amount: 0, count: 0, agents: 0, doubles: 0 };
      x.amount += a.amount; x.count += a.count; x.agents++; x.doubles += a.doubles; t.set(a.team, x);
    }
    const all = refunds.reduce((s, r) => s + r.amount, 0) || 1;
    return [...t.values()].sort((a, b) => b.amount - a.amount).map((x) => ({ ...x, share: x.amount / all }));
  }, [withRate, refunds]);

  const exportCsv = () => download(new Blob([toCsv([
    ["agent_id", "name", "team", "site", "refunds", "refund_inr", "avg_inr", "tickets_resolved", "refunds_per_100_tickets", "coded_goodwill", "double_payouts", "goodwill_over_500", ...months],
    ...list.map((a) => [a.agent_id, a.name, a.team, a.site, a.count, Math.round(a.amount), Math.round(a.avg), a.tickets, +(a.rate * 100).toFixed(1), a.gwReported, a.doubles, a.capBreaches, ...months.map((m) => Math.round(a.byMonth[m]?.amount ?? 0))]),
  ])], { type: "text/csv" }), "refunds-by-agent.csv");

  const open = (a: (typeof withRate)[number]) => openDrawer({ title: `${a.name} (${a.agent_id})`, sub: `${a.team}, ${a.site}.`, ids: refunds.filter((r) => r.agent_id === a.agent_id).map((r) => r.ticket_id) });

  return (
    <Section id="agents" no="04" title="By agent" sub="Who resolved the refunds, in rupees and as a rate against the tickets each person handled. Raw rupees mostly reveal who works the Returns Desk, so compare people within their own team.">
      <div className="panel">
        <h3>By team</h3>
        <div className="tablewrap"><table>
          <thead><tr><th>Team</th><th className="num">Agents</th><th className="num">Refunds</th><th className="num">Rupees</th><th className="num">Share</th><th className="num">Refunds per 100 tickets</th><th className="num">Double payouts</th></tr></thead>
          <tbody>{teamTable.map((t) => (
            <tr key={t.team}>
              <td><button className="link" onClick={() => { setTeam(t.team); document.getElementById("agent-table")?.scrollIntoView({ behavior: "smooth" }); }}>{t.team}</button></td>
              <td className="num">{t.agents}</td><td className="num">{num(t.count)}</td><td className="num">{inr(t.amount)}</td><td className="num">{pct(t.share)}</td>
              <td className="num">{((teamRate.get(t.team) ?? 0) * 100).toFixed(0)}</td><td className="num">{t.doubles || "·"}</td>
            </tr>))}</tbody>
        </table></div>
      </div>

      <div className="panel" id="agent-table">
        <div className="controls" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="seg" role="group" aria-label="Table style">
              <button aria-pressed={view === "summary"} onClick={() => setView("summary")}>Summary</button>
              <button aria-pressed={view === "months"} onClick={() => setView("months")}>Month by month</button>
            </div>
            <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team"><option value="all">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</select>
            <input type="search" placeholder="Find an agent…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an agent" />
          </div>
          <button className="btn ghost small" onClick={exportCsv}>Download (CSV)</button>
        </div>

        <div className="tablewrap" style={{ maxHeight: 620, overflowY: "auto" }}>
          {view === "summary" ? (
            <table aria-label="Refunds by agent">
              <thead><tr>
                <SortHead label="Agent" k="name" sort={sort} setSort={setSort} />
                <SortHead label="Team" k="team" sort={sort} setSort={setSort} />
                <SortHead label="Refunds" k="count" sort={sort} setSort={setSort} num />
                <SortHead label="Rupees" k="amount" sort={sort} setSort={setSort} num />
                <SortHead label="Average" k="avg" sort={sort} setSort={setSort} num />
                <SortHead label="Per 100 tickets" k="rate" sort={sort} setSort={setSort} num />
                <SortHead label="Coded goodwill" k="gw" sort={sort} setSort={setSort} num />
                <SortHead label="Refund + repl." k="dbl" sort={sort} setSort={setSort} num />
                <SortHead label="Goodwill > ₹500" k="cap" sort={sort} setSort={setSort} num />
              </tr></thead>
              <tbody>
                {list.map((a) => {
                  const tr = teamRate.get(a.team) ?? 0;
                  const high = tr > 0 && a.rate > tr * 1.4 && a.tickets >= 20;
                  return (
                    <tr key={a.agent_id}>
                      <td><button className="link" onClick={() => open(a)}>{a.name}</button> <span className="mute mono" style={{ fontSize: 11 }}>{a.agent_id}</span></td>
                      <td>{a.team}<span className="mute"> · {a.site}</span></td>
                      <td className="num">{num(a.count)}</td>
                      <td className="num">{inr(a.amount)} <span className="mute">({pct(a.share)})</span></td>
                      <td className="num">{inr(a.avg)}</td>
                      <td className="num">{(a.rate * 100).toFixed(0)}{high && <span className="chip warn" style={{ marginLeft: 6 }} title={`Team average ${(tr * 100).toFixed(0)}`}>high</span>}</td>
                      <td className="num">{pct(a.gwShare)}{a.gwShare > 0.7 && a.count >= 10 && <span className="chip acc" style={{ marginLeft: 6 }}>habit?</span>}</td>
                      <td className="num">{a.doubles ? <b style={{ color: "var(--accent-ink)" }}>{a.doubles}</b> : "·"}</td>
                      <td className="num">{a.capBreaches || "·"}</td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={9} className="mute">No agents match.</td></tr>}
              </tbody>
              <tfoot><tr><td>Total ({list.length} agents)</td><td /><td className="num">{num(list.reduce((s, a) => s + a.count, 0))}</td><td className="num">{inr(total)}</td><td colSpan={5} /></tr></tfoot>
            </table>
          ) : (
            <table aria-label="Refunds by agent by month">
              <thead><tr><th>Agent</th>{months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>{list.map((a) => (
                <tr key={a.agent_id}><td><button className="link" onClick={() => open(a)}>{a.name}</button></td>
                  {months.map((m) => <td key={m} className="num">{a.byMonth[m] ? inr(a.byMonth[m].amount) : <span className="mute">·</span>}</td>)}
                  <td className="num"><b>{inr(a.amount)}</b></td></tr>))}</tbody>
              <tfoot><tr><td>Total</td>{months.map((m) => <td key={m} className="num">{inr(list.reduce((s, a) => s + (a.byMonth[m]?.amount ?? 0), 0))}</td>)}<td className="num">{inr(total)}</td></tr></tfoot>
            </table>
          )}
        </div>
        <p className="sub" style={{ marginTop: 8 }}>{inrShort(total)} across {list.length} agents. “high” = refund rate 40% above the team&apos;s own average. “habit?” = more than 70% of their refunds coded Goodwill / Other. These are prompts for a conversation, not verdicts.</p>
        <Explain>
          <p><b>Whose name is on a refund?</b> The README defines <span className="mono">agent_id</span> as the agent who resolved the ticket, and the file has no separate “approved by”, so that is the person shown. The roster is matched on the id, never the name, since two agents can share a name and an agent can change shift.</p>
          <p><b>Why a rate?</b> A Returns Desk agent handles refunds by design, so their rupees are always high. The rate (refunds per 100 tickets resolved) puts a Chat agent and a Returns agent on the same footing only within their own team, so compare within a team.</p>
        </Explain>
      </div>
    </Section>
  );
}
