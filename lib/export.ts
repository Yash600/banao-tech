import { byAgent, byReason, byQuarter, doublePayouts, reconciliation, reclassification } from "./analyze";
import { monthLong } from "./format";
import type { Reference } from "./reference";
import type { CleanResult, Refund } from "./types";
import { REASON_LABEL } from "./types";

export interface ExportInput { clean: CleanResult; refunds: Refund[]; ref: Reference; helpdeskQuarterly: number; dataLabel: string }

const INR = '"₹"#,##0';
const INK = "FF1B1A17";

const col = (n: number) => {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

export const ASSUMPTIONS: [string, string][] = [
  ["Quarters", "Calendar quarters (Jan–Mar …). The brief does not say whether the board pack uses Indian financial-year quarters."],
  ["Which date", "A refund belongs to the month the ticket was created, because the file holds no refund-issued date."],
  ["Which agent", "The agent who resolved the ticket (agent_id), as the README defines it. That may not be the person who approved the refund."],
  ["Legacy money", "Freshdesk-era rows are converted using the unit inferred from matching order values. See sheet 1 and the on-screen check."],
  ["Duplicates", "A repeated ticket_id is one ticket. The current-helpdesk copy wins."],
  ["Corrected reasons", "Read from the agent's closing note first, customer message second. If neither says why, the refund is labelled UNCLEAR, never guessed."],
  ["Refund + replacement", "Counted when the refund is positive and either the replacement flag is Y or the closing note says a new unit was sent. Replacement cost = unit cost + ₹340 (policy §5); no refurbishment recovery assumed."],
];

/**
 * Builds the board-pack workbook in the browser. Numbers are real numbers (not text) so Finance can
 * re-sum them, and the first sheet carries the reconciliation so the total ties back to the export.
 */
export async function buildWorkbook(inp: ExportInput): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const { clean, refunds, ref } = inp;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vireo Refund Ledger";
  type WS = import("exceljs").Worksheet;
  const head = (ws: WS, row: number) => {
    const r = ws.getRow(row);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    r.alignment = { vertical: "middle", wrapText: true };
  };
  const title = (ws: WS, text: string, sub?: string) => {
    ws.addRow([text]).font = { bold: true, size: 14 };
    ws.addRow([sub ?? ""]).font = { italic: true, color: { argb: "FF6B675E" } };
    ws.addRow([]);
  };

  // 1. Reconciliation
  const s = wb.addWorksheet("1 Reconciliation", { views: [{ showGridLines: false }] });
  s.columns = [{ width: 52 }, { width: 20 }, { width: 78 }];
  title(s, "Refunds: reconciliation", `Source: ${inp.dataLabel} · ${clean.dateRange?.[0]} to ${clean.dateRange?.[1]} · ${clean.uniqueTickets} unique tickets`);
  const h = s.addRow(["Step", "Rupees", "What it means"]);
  head(s, h.number);
  const wf = reconciliation(clean);
  const firstStep = h.number + 1;
  for (const w of wf) {
    const r = s.addRow([w.label, Math.round(w.amount), w.note]);
    r.getCell(2).numFmt = INR;
    if (w.kind !== "minus") r.font = { bold: true };
  }
  const lastStep = firstStep + wf.length - 1;
  s.addRow([]);
  const chk = s.addRow(["Check: start + adjustments − end", { formula: `B${firstStep}+SUM(B${firstStep + 1}:B${lastStep - 1})-B${lastStep}` }, "Should be 0 (rounding aside)"]);
  chk.getCell(2).numFmt = INR;
  s.addRow([]);
  const qh = s.addRow(["Quarter", "Refunds (₹)", `Tickets · refunds · against the helpdesk report of ₹${(inp.helpdeskQuarterly / 1e5).toFixed(1)} lakh`]);
  head(s, qh.number);
  for (const q of byQuarter(refunds, clean)) {
    const r = s.addRow([q.label + (q.complete ? "" : " (partial)"), Math.round(q.amount), `${q.tickets} tickets · ${q.count} refunds · ${((q.amount / inp.helpdeskQuarterly - 1) * 100).toFixed(0)}% vs report`]);
    r.getCell(2).numFmt = INR;
  }

  // 2 & 3. Monthly by reason
  for (const view of ["corrected", "reported"] as const) {
    const d = byReason(refunds, view);
    const ws = wb.addWorksheet(view === "corrected" ? "2 By reason (corrected)" : "3 By reason (as coded)", { views: [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }] });
    title(ws, view === "corrected" ? "Monthly refunds by reason, corrected from ticket notes" : "Monthly refunds by reason, exactly as agents coded them",
      view === "corrected" ? "Rupees. UNCLEAR = the notes do not say why; left unguessed." : "Shown for comparison. The first dropdown option, GW-OTHER, is heavily over-used.");
    const labels = REASON_LABEL as Record<string, string>;
    const hr = ws.addRow(["Month", ...d.codes.map((c) => (labels[c] ? `${c}\n${labels[c]}` : c)), "Total"]);
    head(ws, hr.number);
    hr.height = 44;
    ws.getColumn(1).width = 14;
    for (let i = 0; i <= d.codes.length; i++) ws.getColumn(i + 2).width = 17;
    const first = hr.number + 1;
    for (const m of d.months) {
      const r = ws.addRow([monthLong(m), ...d.codes.map((c) => Math.round(d.matrix[m][c]?.amount ?? 0)), null]);
      r.getCell(d.codes.length + 2).value = { formula: `SUM(B${r.number}:${col(d.codes.length + 1)}${r.number})` };
      for (let c = 2; c <= d.codes.length + 2; c++) r.getCell(c).numFmt = INR;
    }
    const last = ws.rowCount;
    const t = ws.addRow(["Total", ...d.codes.map((_, i) => ({ formula: `SUM(${col(i + 2)}${first}:${col(i + 2)}${last})` })), { formula: `SUM(${col(d.codes.length + 2)}${first}:${col(d.codes.length + 2)}${last})` }]);
    t.font = { bold: true };
    for (let c = 2; c <= d.codes.length + 2; c++) t.getCell(c).numFmt = INR;
  }

  // 4. By agent by month
  const agents = byAgent(refunds, ref);
  const months = [...new Set(refunds.map((r) => r.month))].sort();
  const wa = wb.addWorksheet("4 By agent by month", { views: [{ state: "frozen", xSplit: 3, ySplit: 4, showGridLines: false }] });
  title(wa, "Monthly refunds by resolving agent", "Rupees. Agents are matched by agent_id, not name.");
  const ah = wa.addRow(["Agent", "Name", "Team", ...months.map(monthLong), "Total", "Refunds", "Avg ₹", "GW-OTHER as coded", "Truly goodwill", "Double payouts"]);
  head(wa, ah.number);
  ah.height = 32;
  wa.getColumn(1).width = 9; wa.getColumn(2).width = 22; wa.getColumn(3).width = 22;
  const af = ah.number + 1;
  for (const a of agents) {
    const r = wa.addRow([a.agent_id, a.name, a.team, ...months.map((m) => Math.round(a.byMonth[m]?.amount ?? 0)), Math.round(a.amount), a.count, Math.round(a.avg), a.gwReported, a.gwCorrected, a.doubles]);
    for (let c = 4; c <= 4 + months.length; c++) r.getCell(c).numFmt = INR;
    r.getCell(6 + months.length).numFmt = INR;
  }
  const al = wa.rowCount;
  const tr = wa.addRow(["", "Total", "", ...months.map((_, i) => ({ formula: `SUM(${col(4 + i)}${af}:${col(4 + i)}${al})` })), { formula: `SUM(${col(4 + months.length)}${af}:${col(4 + months.length)}${al})` }]);
  tr.font = { bold: true };
  for (let c = 4; c <= 4 + months.length; c++) tr.getCell(c).numFmt = INR;

  // 5. Double payouts
  void doublePayouts;
  const wd = wb.addWorksheet("5 Refund + replacement", { views: [{ showGridLines: false }] });
  title(wd, "Customers who got both a refund and a replacement", "Policy §5: never both. Replacement cost = unit cost + ₹340. Send this list to Team Leads and Finance.");
  const dh = wd.addRow(["Ticket", "Month", "Agent", "Name", "Team", "Refund ₹", "Replacement cost ₹", "Total ₹", "Flag ticked?", "Found by", "Agent note"]);
  head(wd, dh.number);
  [10, 10, 9, 20, 22, 12, 18, 12, 12, 16, 70].forEach((w, i) => (wd.getColumn(i + 1).width = w));
  for (const r of refunds.filter((x) => x.doublePayout).sort((a, b) => b.amount - a.amount)) {
    const row = wd.addRow([r.ticket_id, r.month, r.agent_id, ref.agents[r.agent_id]?.name ?? "", r.team, Math.round(r.amount), Math.round(r.replacementCost), Math.round(r.amount + r.replacementCost), r.replacementFlag ? "Y" : "N", r.replacementFlag && r.replacementInNote ? "flag + note" : r.replacementFlag ? "flag only" : "note only", r.note]);
    [6, 7, 8].forEach((c) => (row.getCell(c).numFmt = INR));
  }

  // 6. Reason changes
  const rc = reclassification(refunds);
  const wr = wb.addWorksheet("6 Reason changes", { views: [{ showGridLines: false }] });
  title(wr, "Tickets where the corrected reason differs from the agent's code", `${rc.gwReportedCount} refunds were coded GW-OTHER; ${rc.movedOutCount} of them are something else on reading the notes.`);
  const rh = wr.addRow(["Ticket", "Month", "Agent", "Amount ₹", "Agent coded", "Corrected to", "How", "Evidence", "Agent note"]);
  head(wr, rh.number);
  [10, 10, 9, 12, 14, 16, 14, 34, 70].forEach((w, i) => (wr.getColumn(i + 1).width = w));
  for (const r of refunds.filter((x) => x.reportedCode !== x.code)) {
    const row = wr.addRow([r.ticket_id, r.month, r.agent_id, Math.round(r.amount), r.reportedCode || "(blank)", r.code, r.codeSource === "llm" ? "AI reading" : r.codeSource === "rules" ? "Keyword rule" : "Weak rule", r.evidence, r.note]);
    row.getCell(4).numFmt = INR;
  }

  // 7. Data issues + assumptions
  const wq = wb.addWorksheet("7 Data issues & assumptions", { views: [{ showGridLines: false }] });
  wq.columns = [{ width: 34 }, { width: 10 }, { width: 16 }, { width: 100 }];
  title(wq, "What was wrong with the export, and what we assumed");
  const qh2 = wq.addRow(["Issue", "Rows", "Rupees", "Detail"]);
  head(wq, qh2.number);
  for (const i of clean.issues) {
    const row = wq.addRow([i.title, i.count ?? "", i.rupees != null ? Math.round(i.rupees) : "", i.detail]);
    row.getCell(3).numFmt = INR;
    row.alignment = { wrapText: true, vertical: "top" };
  }
  wq.addRow([]);
  wq.addRow(["Assumptions"]).font = { bold: true };
  for (const a of ASSUMPTIONS) wq.addRow([a[0], "", "", a[1]]).alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
