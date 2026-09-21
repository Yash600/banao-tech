import { parseAmount, parseDate, quarterOf, type ParsedCsv } from "./csv";
import { classifyByRules, replacementMentioned } from "./rules";
import { matchOrder, type Reference } from "./reference";
import type { CleanResult, Issue, RawTicket, Refund } from "./types";

const CUTOVER = "2025-09-14";
const REPLACEMENT_LOGISTICS = 340; // policy §5: reverse pickup + forward shipping
const GOODWILL_CAP = 500; // policy §5

const isLegacy = (t: RawTicket, created: string | null) => {
  const s = (t.source_system || "").toLowerCase();
  if (s) return s.includes("legacy") || s.includes("fresh");
  return created ? created.slice(0, 10) < CUTOVER : false; // column missing: fall back to the go-live date
};

interface Row {
  t: RawTicket;
  idx: number;
  id: string;
  created: string | null;
  amount: number | null;
  legacy: boolean;
}

export interface CleanOptions {
  /** Force a legacy-unit divisor (1, 10, 100, 1000). null/undefined = infer from data. */
  unitFactor?: number | null;
}

export function cleanTickets(parsed: ParsedCsv, ref: Reference, opts: CleanOptions = {}): CleanResult {
  const issues: Issue[] = [];
  const rowsSkipped: CleanResult["rowsSkipped"] = [];
  const rows: Row[] = [];
  let rawSum = 0;
  let skippedSum = 0;

  parsed.rows.forEach((t, i) => {
    const id = (t.ticket_id || "").trim().toUpperCase();
    const created = parseDate(t.created_at);
    const amount = parseAmount(t.refund_amount_inr);
    if (amount != null) rawSum += amount;
    if (!id || !created) {
      rowsSkipped.push({ row: i + 2, reason: !id ? "no ticket id" : `unreadable created_at “${t.created_at ?? ""}”` });
      if (amount != null) skippedSum += amount;
      return;
    }
    rows.push({ t, idx: i, id, created, amount, legacy: isLegacy(t, created) });
  });

  // ---- 1. de-duplicate by ticket_id, preferring the current-helpdesk copy ----
  const groups = new Map<string, Row[]>();
  for (const r of rows) (groups.get(r.id) ?? groups.set(r.id, []).get(r.id)!).push(r);
  const kept: Row[] = [];
  const dropped: Row[] = [];
  const dupGroups: Row[][] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { kept.push(g[0]); continue; }
    dupGroups.push(g);
    const keep = g.find((r) => !r.legacy) ?? g[0];
    kept.push(keep);
    for (const r of g) if (r !== keep) dropped.push(r);
  }
  const dupSum = dropped.reduce((s, r) => s + (r.amount ?? 0), 0);

  // ---- 2. legacy money unit: infer from refunds that match an order value ----
  const cand = [1, 10, 100, 1000];
  const votes: Record<number, number> = { 1: 0, 10: 0, 100: 0, 1000: 0 };
  let sample = 0;
  for (const r of kept) {
    if (!r.legacy || !r.amount || r.amount <= 0) continue;
    const o = matchOrder(ref, (r.t.order_id || "").trim(), (r.t.customer_id || "").trim(), (r.t.product_sku || "").trim(), r.created!);
    if (!o) continue;
    sample++;
    for (const f of cand) {
      const ratio = r.amount / f / o.order_value_inr;
      if (ratio >= 0.85 && ratio <= 1.15) votes[f]++;
    }
  }
  const legacyRefunds = kept.filter((r) => r.legacy && r.amount).length;
  let factor = 1;
  let method: CleanResult["unit"]["method"] = "inferred";
  let unitNote = "";
  if (opts.unitFactor) {
    factor = opts.unitFactor; method = "manual";
    unitNote = `Set by you: legacy amounts divided by ${factor}.`;
  } else if (legacyRefunds === 0) {
    unitNote = "No legacy Freshdesk refunds in this file, so no unit correction was needed.";
  } else {
    const ranked = cand.map((f) => [f, votes[f]] as const).sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] >= 5 && ranked[0][1] >= ranked[1][1] * 2) {
      factor = ranked[0][0];
      unitNote = factor === 1
        ? `Legacy amounts already match order values, so no correction. ${ranked[0][1]} of ${sample} checked refunds agreed.`
        : `${ranked[0][1]} of ${sample} legacy refunds equal the order value only after dividing by ${factor}.`;
    } else {
      factor = 100; method = "default";
      unitNote = `Only ${sample} legacy refunds could be matched to an order, too few to be sure. Assumed paise (÷100). Check this before using the numbers.`;
    }
  }

  // duplicate copies that disagree even after unit correction
  let conflicting = 0;
  for (const g of dupGroups) {
    const vals = g.map((r) => (r.amount == null ? null : r.legacy ? r.amount / factor : r.amount));
    if (vals.some((v) => v !== vals[0] && !(v != null && vals[0] != null && Math.abs(v - vals[0]) <= 1))) conflicting++;
  }

  // ---- 3. build refund records ----
  const refunds: Refund[] = [];
  const allTickets: CleanResult["allTickets"] = [];
  let unitAdjustment = 0;
  let missingSku = 0;
  let unknownAgents = 0;
  let negatives = 0;
  let noReasonCode = 0;

  for (const r of kept) {
    const t = r.t;
    const csatN = Number(t.csat_score);
    const csat = t.csat_score && csatN >= 1 && csatN <= 5 ? csatN : null; // blank = no response, never zero
    const month = r.created!.slice(0, 7);
    const agent = (t.agent_id || "").trim().toUpperCase() || "UNASSIGNED";
    const ag = ref.agents[agent];
    const team = ag?.team || (t.assigned_team || "Unknown");
    const hasRefund = r.amount != null && r.amount !== 0;
    allTickets.push({ month, team, agent_id: agent, hasRefund, csat, created: r.created! });
    if (!hasRefund) continue;

    if (!ag) unknownAgents++;
    const scaled = r.legacy && factor !== 1;
    const amount = scaled ? r.amount! / factor : r.amount!;
    if (scaled) unitAdjustment += r.amount! - amount;
    if (amount < 0) negatives++;
    if (!(t.refund_reason_code || "").trim()) noReasonCode++;

    const message = t.customer_message || "";
    const note = t.agent_notes || "";
    const v = classifyByRules(message, note, (t.refund_reason_code || "").trim().toUpperCase());
    const sku = (t.product_sku || "").trim();
    const prod = ref.products[sku];
    if (!prod) missingSku++;
    const order = matchOrder(ref, (t.order_id || "").trim(), (t.customer_id || "").trim(), sku, r.created!);
    const replFlag = /^y/i.test((t.replacement_issued || "").trim());
    const replNote = replacementMentioned(note);
    const double = amount > 0 && (replFlag || replNote);

    refunds.push({
      ticket_id: r.id,
      month,
      quarter: quarterOf(r.created!),
      created_at: r.created!,
      agent_id: agent,
      team,
      source_system: r.legacy ? "legacy_fd" : "helpdesk",
      amount,
      rawAmount: r.amount!,
      scaled,
      reportedCode: (t.refund_reason_code || "").trim().toUpperCase(),
      code: v.code,
      codeSource: v.settled ? "rules" : "rules-fallback",
      confidence: v.confidence,
      evidence: v.evidence,
      message,
      note,
      sku,
      orderId: order?.order_id || "",
      orderValue: order?.order_value_inr ?? null,
      lot: order?.lot_code || "",
      replacementFlag: replFlag,
      replacementInNote: replNote,
      doublePayout: double,
      replacementCost: double && prod ? prod.unit_cost_inr + REPLACEMENT_LOGISTICS : 0,
      capBreach: false, // set after classification is final (see analyze)
      csat,
    });
  }

  const cleanSum = refunds.reduce((s, r) => s + r.amount, 0);

  // ---- 4. issues: everything the person should know before trusting a number ----
  if (parsed.missingRequired.length)
    issues.push({ kind: "warn", title: "Required columns missing", detail: `This file has no ${parsed.missingRequired.join(", ")}. Numbers that depend on them cannot be trusted.` });
  if (parsed.missingOptional.length)
    issues.push({ kind: "info", title: "Some README columns are absent", detail: `Not in this file: ${parsed.missingOptional.join(", ")}. Features that need them are switched off.` });
  if (dropped.length)
    issues.push({ kind: "fix", title: "Duplicate tickets removed", detail: `${dropped.length} rows repeated a ticket_id already in the file (the migration re-import). The current-helpdesk copy was kept.`, count: dropped.length, rupees: dupSum });
  if (conflicting)
    issues.push({ kind: "warn", title: "Duplicates that disagree", detail: `${conflicting} duplicated tickets carry different refund amounts in their two copies. We kept the helpdesk copy; worth a look.`, count: conflicting });
  if (unitAdjustment > 0.5)
    issues.push({ kind: "fix", title: "Legacy money converted to rupees", detail: unitNote, count: refunds.filter((x) => x.scaled).length, rupees: unitAdjustment });
  else if (legacyRefunds) issues.push({ kind: "info", title: "Legacy money unit", detail: unitNote });
  if (method === "default") issues.push({ kind: "warn", title: "Unit correction is an assumption", detail: unitNote });
  if (rowsSkipped.length)
    issues.push({ kind: "warn", title: "Rows skipped", detail: `${rowsSkipped.length} rows had no ticket id or an unreadable date and are left out of the monthly view${skippedSum ? " (their refunds are shown separately in the reconciliation)" : ""}.`, count: rowsSkipped.length, rupees: skippedSum || undefined });
  if (noReasonCode)
    issues.push({ kind: "info", title: "Refunds with no reason code", detail: `${noReasonCode} refunds have a blank reason code. They are classified from the notes.`, count: noReasonCode });
  if (negatives) issues.push({ kind: "info", title: "Negative refunds (reversals)", detail: `${negatives} refund rows are negative and reduce the totals.`, count: negatives });
  if (unknownAgents) issues.push({ kind: "warn", title: "Agents not in the roster", detail: `${unknownAgents} refunds belong to an agent_id missing from agents.csv. They appear as “Unknown”.`, count: unknownAgents });
  if (missingSku) issues.push({ kind: "info", title: "Unknown product SKU", detail: `${missingSku} refunds reference a SKU not in products.csv, so replacement cost could not be worked out for them.`, count: missingSku });

  const dates = rows.map((r) => r.created!).sort();
  return {
    totalRows: parsed.rows.length,
    uniqueTickets: kept.length,
    duplicatesRemoved: dropped.length,
    conflictingDuplicates: conflicting,
    refunds,
    allTickets,
    unit: { factor, method, sampleSize: sample, note: unitNote },
    rawSum,
    dupSum,
    skippedSum,
    unitAdjustment,
    cleanSum,
    issues,
    rowsSkipped,
    missingColumns: parsed.missingRequired,
    dateRange: dates.length ? [dates[0].slice(0, 10), dates[dates.length - 1].slice(0, 10)] : null,
  };
}

export { GOODWILL_CAP, REPLACEMENT_LOGISTICS };
