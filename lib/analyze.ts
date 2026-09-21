import { quarterLabel } from "./csv";
import { GOODWILL_CAP } from "./pipeline";
import type { Reference } from "./reference";
import type { CleanResult, CorrectedCode, Refund } from "./types";
import { REASON_CODES } from "./types";

export type View = "corrected" | "reported";
const codeOf = (r: Refund, v: View): string => (v === "corrected" ? r.code : r.reportedCode || "(blank)");

export interface Cell { amount: number; count: number }

export function monthsOf(refunds: Refund[]): string[] {
  return [...new Set(refunds.map((r) => r.month))].sort();
}

/** month x code matrix */
export function byReason(refunds: Refund[], view: View) {
  const months = monthsOf(refunds);
  const codes = view === "corrected" ? [...REASON_CODES, "UNCLEAR"] : [...REASON_CODES, "(blank)"];
  const extra = [...new Set(refunds.map((r) => codeOf(r, view)))].filter((c) => !codes.includes(c as never));
  const all = [...codes, ...extra];
  const m: Record<string, Record<string, Cell>> = {};
  for (const mo of months) { m[mo] = {}; for (const c of all) m[mo][c] = { amount: 0, count: 0 }; }
  for (const r of refunds) { const c = m[r.month][codeOf(r, view)]; c.amount += r.amount; c.count++; }
  const totals: Record<string, Cell> = {};
  for (const c of all) totals[c] = { amount: months.reduce((s, mo) => s + m[mo][c].amount, 0), count: months.reduce((s, mo) => s + m[mo][c].count, 0) };
  return { months, codes: all.filter((c) => totals[c].count > 0 || (REASON_CODES as readonly string[]).includes(c)), matrix: m, totals };
}

export interface AgentRow {
  agent_id: string; name: string; team: string; site: string; tier: string;
  amount: number; count: number; avg: number;
  byMonth: Record<string, Cell>;
  gwReported: number; gwCorrected: number; // count coded / truly goodwill
  doubles: number; doubleValue: number;
  capBreaches: number;
  share: number; // share of all refund rupees
}

export function byAgent(refunds: Refund[], ref: Reference): AgentRow[] {
  const map = new Map<string, AgentRow>();
  const total = refunds.reduce((s, r) => s + r.amount, 0) || 1;
  for (const r of refunds) {
    let a = map.get(r.agent_id);
    if (!a) {
      const info = ref.agents[r.agent_id];
      a = { agent_id: r.agent_id, name: info?.name ?? `Unknown (${r.agent_id})`, team: info?.team ?? r.team, site: info?.site ?? "—", tier: info?.tier ?? "—",
        amount: 0, count: 0, avg: 0, byMonth: {}, gwReported: 0, gwCorrected: 0, doubles: 0, doubleValue: 0, capBreaches: 0, share: 0 };
      map.set(r.agent_id, a);
    }
    a.amount += r.amount; a.count++;
    (a.byMonth[r.month] ||= { amount: 0, count: 0 }).amount += r.amount;
    a.byMonth[r.month].count++;
    if (r.reportedCode === "GW-OTHER") a.gwReported++;
    if (r.code === "GW-OTHER") a.gwCorrected++;
    if (r.doublePayout) { a.doubles++; a.doubleValue += r.amount + r.replacementCost; }
    if (r.capBreach) a.capBreaches++;
  }
  for (const a of map.values()) { a.avg = a.count ? a.amount / a.count : 0; a.share = a.amount / total; }
  return [...map.values()].sort((x, y) => y.amount - x.amount);
}

export function markCapBreaches(refunds: Refund[]): Refund[] {
  return refunds.map((r) => ({ ...r, capBreach: r.code === "GW-OTHER" && r.amount > GOODWILL_CAP }));
}

export interface Waterfall { label: string; amount: number; kind: "start" | "minus" | "end"; note: string }
export function reconciliation(c: CleanResult): Waterfall[] {
  const rows: Waterfall[] = [{ label: "Sum of the export as it stands", amount: c.rawSum, kind: "start", note: "Every refund cell added up, exactly what a spreadsheet SUM shows." }];
  if (c.dupSum) rows.push({ label: "Duplicate tickets (migration re-import)", amount: -c.dupSum, kind: "minus", note: `${c.duplicatesRemoved} rows repeated a ticket already counted.` });
  if (c.skippedSum) rows.push({ label: "Rows we could not place in a month", amount: -c.skippedSum, kind: "minus", note: "No ticket id or unreadable date. Look at these by hand." });
  if (c.unitAdjustment > 0.5) rows.push({ label: "Legacy Freshdesk money converted to rupees", amount: -c.unitAdjustment, kind: "minus", note: `Legacy amounts ÷ ${c.unit.factor}.` });
  rows.push({ label: "Refunds, cleaned", amount: c.cleanSum, kind: "end", note: "The figure used in every table that follows." });
  return rows;
}

export interface QuarterRow { quarter: string; label: string; amount: number; count: number; tickets: number; complete: boolean }
export function byQuarter(refunds: Refund[], c: CleanResult): QuarterRow[] {
  const m = new Map<string, QuarterRow>();
  for (const r of refunds) {
    const q = m.get(r.quarter) ?? { quarter: r.quarter, label: quarterLabel(r.quarter), amount: 0, count: 0, tickets: 0, complete: true };
    q.amount += r.amount; q.count++; m.set(r.quarter, q);
  }
  for (const t of c.allTickets) {
    const y = t.month.slice(0, 4), qn = Math.floor((Number(t.month.slice(5)) - 1) / 3) + 1;
    const q = m.get(`${y}-Q${qn}`); if (q) q.tickets++;
  }
  const rows = [...m.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
  // a quarter is complete only if the file has data past its final month
  const last = c.dateRange?.[1] ?? "";
  for (const q of rows) {
    const [y, qq] = q.quarter.split("-Q");
    const endMonth = Number(qq) * 3;
    q.complete = last >= `${y}-${String(endMonth).padStart(2, "0")}-28`;
  }
  return rows;
}

export interface Doubles {
  count: number; refundValue: number; replacementValue: number; total: number;
  shareOfRefunds: number; shareOfValue: number;
  byQuarter: { quarter: string; count: number; value: number }[];
  byAgent: { agent_id: string; name: string; team: string; count: number; value: number }[];
  perQuarterRunRate: number; // last 6 months ÷ 2
  recentShare: number; // share of refunds in the last 6 months
  flaggedByNoteOnly: number; // replacement mentioned in note, flag not ticked
}
export function doublePayouts(refunds: Refund[], ref: Reference): Doubles {
  const d = refunds.filter((r) => r.doublePayout);
  const refundValue = d.reduce((s, r) => s + r.amount, 0);
  const replacementValue = d.reduce((s, r) => s + r.replacementCost, 0);
  const total = refundValue + replacementValue;
  const q = new Map<string, { count: number; value: number }>();
  const a = new Map<string, { count: number; value: number }>();
  for (const r of d) {
    const v = r.amount + r.replacementCost;
    const qq = q.get(r.quarter) ?? { count: 0, value: 0 }; qq.count++; qq.value += v; q.set(r.quarter, qq);
    const aa = a.get(r.agent_id) ?? { count: 0, value: 0 }; aa.count++; aa.value += v; a.set(r.agent_id, aa);
  }
  const months = monthsOf(refunds);
  const last6 = new Set(months.slice(-6));
  const runRate = d.filter((r) => last6.has(r.month)).reduce((s, r) => s + r.amount + r.replacementCost, 0) / 2;
  const totalValue = refunds.reduce((s, r) => s + r.amount, 0) || 1;
  const recent = refunds.filter((r) => last6.has(r.month));
  return {
    count: d.length, refundValue, replacementValue, total,
    shareOfRefunds: refunds.length ? d.length / refunds.length : 0,
    shareOfValue: refundValue / totalValue,
    byQuarter: [...q.entries()].sort().map(([quarter, v]) => ({ quarter, ...v })),
    byAgent: [...a.entries()].map(([agent_id, v]) => ({ agent_id, name: ref.agents[agent_id]?.name ?? agent_id, team: ref.agents[agent_id]?.team ?? "—", ...v })).sort((x, y) => y.value - x.value),
    perQuarterRunRate: runRate,
    recentShare: recent.length ? recent.filter((r) => r.doublePayout).length / recent.length : 0,
    flaggedByNoteOnly: d.filter((r) => !r.replacementFlag && r.replacementInNote).length,
  };
}

/** Priya's claim: refunds rose because the frontline stopped arguing, and CSAT rose 0.4. Test both halves. */
export interface Q4Test {
  rows: { quarter: string; label: string; frontline: number; returns: number; other: number; total: number; csat: number | null; csatN: number; gwCoded: number }[];
  frontlineShareOfRise: number | null; returnsShareOfRise: number | null;
  csatDelta: number | null;
  csatVsPrior: number | null; // Q4 vs the average of all earlier quarters
  verdict: string;
}
const groupOf = (team: string) => (/Frontline/i.test(team) ? "frontline" : /Returns/i.test(team) ? "returns" : "other");
export function q4Test(refunds: Refund[], c: CleanResult): Q4Test {
  const rows = new Map<string, Q4Test["rows"][number]>();
  const get = (q: string) => rows.get(q) ?? rows.set(q, { quarter: q, label: quarterLabel(q), frontline: 0, returns: 0, other: 0, total: 0, csat: null, csatN: 0, gwCoded: 0 }).get(q)!;
  for (const r of refunds) { const q = get(r.quarter); q[groupOf(r.team)] += r.amount; q.total += r.amount; if (r.reportedCode === "GW-OTHER") q.gwCoded++; }
  const sums = new Map<string, { s: number; n: number }>();
  for (const t of c.allTickets) {
    if (t.csat == null) continue; // blank = no response, excluded
    const y = t.month.slice(0, 4), qn = Math.floor((Number(t.month.slice(5)) - 1) / 3) + 1;
    const k = `${y}-Q${qn}`; const s = sums.get(k) ?? { s: 0, n: 0 }; s.s += t.csat; s.n++; sums.set(k, s);
  }
  for (const [k, v] of sums) { const r = rows.get(k); if (r) { r.csat = v.s / v.n; r.csatN = v.n; } }
  const list = [...rows.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
  const i = list.findIndex((r) => r.quarter.endsWith("Q4") && r.quarter.startsWith("2025"));
  let front: number | null = null, ret: number | null = null, csatDelta: number | null = null, csatVsPrior: number | null = null;
  let verdict = "The file does not cover Q3 to Q4 2025, so the Q4 claim cannot be tested.";
  if (i > 0) {
    const a = list[i - 1], b = list[i];
    const rise = b.total - a.total;
    if (rise > 0) {
      front = (b.frontline - a.frontline) / rise; ret = (b.returns - a.returns) / rise;
    }
    if (a.csat != null && b.csat != null) csatDelta = b.csat - a.csat;
    const earlier = list.slice(0, i).filter((r) => r.csat != null);
    if (earlier.length && b.csat != null) csatVsPrior = b.csat - earlier.reduce((s2, r) => s2 + (r.csat as number), 0) / earlier.length;
    const parts: string[] = [];
    if (rise > 0 && front != null && ret != null) {
      parts.push(`Refunds rose by ₹${Math.round(rise).toLocaleString("en-IN")} from ${a.label} to ${b.label}. The frontline accounts for ${Math.round(front * 100)}% of that rise and the Returns Desk for ${Math.round(ret * 100)}%.`);
    } else parts.push(`Refunds did not rise between ${a.label} and ${b.label} in this file.`);
    if (csatDelta != null) parts.push(`CSAT moved ${csatDelta >= 0 ? "+" : ""}${csatDelta.toFixed(2)} on the previous quarter${csatVsPrior != null ? ` and ${csatVsPrior >= 0 ? "+" : ""}${csatVsPrior.toFixed(2)} on the average of the earlier quarters` : ""} (blank surveys excluded).`);
    verdict = parts.join(" ");
  }
  return { rows: list, frontlineShareOfRise: front, returnsShareOfRise: ret, csatDelta, csatVsPrior, verdict };
}

export interface LotRow { lot: string; orders: number; refunds: number; rate: number; doa: number; sku: string }
/** Lots whose refund rate is well above the product's norm: hints at a manufacturing batch problem. */
export function badLots(refunds: Refund[], ref: Reference): { baseline: number; lots: LotRow[] } {
  const orderCount = new Map<string, number>();
  for (const o of ref.orders) orderCount.set(o.lot_code, (orderCount.get(o.lot_code) ?? 0) + 1);
  const rc = new Map<string, { n: number; doa: number; sku: string }>();
  for (const r of refunds) {
    if (!r.lot) continue;
    const x = rc.get(r.lot) ?? { n: 0, doa: 0, sku: r.sku }; x.n++; if (r.code === "DOA-REPL") x.doa++; rc.set(r.lot, x);
  }
  const totalOrders = ref.orders.length || 1;
  const baseline = refunds.filter((r) => r.lot).length / totalOrders;
  const lots: LotRow[] = [];
  for (const [lot, v] of rc) {
    const orders = orderCount.get(lot) ?? 0;
    if (orders < 20 || v.n < 8) continue;
    const rate = v.n / orders;
    if (rate >= baseline * 2 && v.doa / v.n >= 0.4) lots.push({ lot, orders, refunds: v.n, rate, doa: v.doa, sku: v.sku });
  }
  return { baseline, lots: lots.sort((a, b) => b.rate - a.rate).slice(0, 8) };
}

export function reclassification(refunds: Refund[]) {
  const gwReported = refunds.filter((r) => r.reportedCode === "GW-OTHER");
  const moved: Partial<Record<CorrectedCode, Cell>> = {};
  for (const r of gwReported) { const c = (moved[r.code] ||= { amount: 0, count: 0 }); c.amount += r.amount; c.count++; }
  const stay = moved["GW-OTHER"] ?? { amount: 0, count: 0 };
  const total = gwReported.reduce((s, r) => s + r.amount, 0);
  const agreeAll = refunds.filter((r) => r.reportedCode && r.reportedCode === r.code).length;
  return {
    gwReportedCount: gwReported.length, gwReportedAmount: total, moved,
    trulyGoodwill: stay, movedOutCount: gwReported.length - stay.count, movedOutAmount: total - stay.amount,
    gwShareReported: refunds.length ? gwReported.length / refunds.length : 0,
    agreementRate: refunds.length ? agreeAll / refunds.length : 0,
  };
}
