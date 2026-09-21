/**
 * Accuracy check against the synthetic answer key.  Run: npm run eval
 * Reports what the tool gets right and wrong so the numbers in the memo are measured, not claimed.
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { parseTicketsCsv } from "../lib/csv";
import { buildReference } from "../lib/reference";
import { cleanTickets } from "../lib/pipeline";

const ROOT = path.resolve(__dirname, "..");
const csv = (f: string) => Papa.parse<Record<string, string>>(fs.readFileSync(path.join(ROOT, f), "utf8"), { header: true, skipEmptyLines: true }).data;
const ref = buildReference(csv("data/ref/agents.csv"), csv("data/ref/products.csv"), csv("data/ref/orders.csv"));
const parsed = parseTicketsCsv(fs.readFileSync(path.join(ROOT, "data/tickets.synthetic.csv"), "utf8"));
const truth = Object.fromEntries(csv("data/tickets.truth.csv").map((r) => [r.ticket_id, r]));
const res = cleanTickets(parsed, ref);

console.log("rows", res.totalRows, "unique", res.uniqueTickets, "dups removed", res.duplicatesRemoved);
console.log("unit", res.unit);
const trueSum = Object.values(truth).reduce((s, r) => s + (Number(r.true_refund_inr) || 0), 0);
console.log("raw sum   ", Math.round(res.rawSum).toLocaleString("en-IN"));
console.log("clean sum ", Math.round(res.cleanSum).toLocaleString("en-IN"), "| true", trueSum.toLocaleString("en-IN"), "| diff", Math.round(res.cleanSum - trueSum));
console.log("reconcile identity gap", Math.round(res.rawSum - res.dupSum - res.skippedSum - res.unitAdjustment - res.cleanSum));

let ok = 0, wrong = 0, unclear = 0, settledOk = 0, settledN = 0;
const confusion: Record<string, number> = {};
let agentOk = 0;
for (const r of res.refunds) {
  const t = truth[r.ticket_id];
  if (!t.true_reason) continue;
  if (r.reportedCode === t.true_reason) agentOk++;
  if (r.code === "UNCLEAR") { unclear++; continue; }
  if (r.code === t.true_reason) ok++; else { wrong++; const k = `${t.true_reason} -> ${r.code}`; confusion[k] = (confusion[k] || 0) + 1; }
  if (r.codeSource === "rules") { settledN++; if (r.code === t.true_reason) settledOk++; }
}
const n = res.refunds.length;
console.log(`\nreason: agent dropdown correct ${(agentOk / n * 100).toFixed(1)}%`);
console.log(`rules: correct ${ok}, wrong ${wrong}, unclear ${unclear}  => ${(ok / n * 100).toFixed(1)}% right overall`);
console.log(`rules 'settled' (skip LLM): ${settledN} tickets, ${(settledOk / settledN * 100).toFixed(1)}% correct`);
console.log("top confusions", Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 8));

let tp = 0, fp = 0, fn = 0;
for (const r of res.refunds) { const d = truth[r.ticket_id].double_payout === "Y"; if (r.doublePayout && d) tp++; else if (r.doublePayout) fp++; else if (d) fn++; }
console.log(`\ndouble payouts: found ${tp}, false alarms ${fp}, missed ${fn}  (precision ${(tp / (tp + fp) * 100).toFixed(1)}%, recall ${(tp / (tp + fn) * 100).toFixed(1)}%)`);
