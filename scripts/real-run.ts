/** Run the pipeline on a real export and print a summary.  npx tsx scripts/real-run.ts private/tickets.real.csv */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { parseTicketsCsv, quarterLabel } from "../lib/csv";
import { buildReference } from "../lib/reference";
import { cleanTickets } from "../lib/pipeline";
import { byQuarter, doublePayouts } from "../lib/analyze";
import { classifyByRules } from "../lib/rules";

const ROOT = path.resolve(__dirname, "..");
const csv = (f: string) => Papa.parse<Record<string, string>>(fs.readFileSync(path.join(ROOT, "data/ref", f), "utf8"), { header: true, skipEmptyLines: true }).data;
const ref = buildReference(csv("agents.csv"), csv("products.csv"), csv("orders.csv"));
const p = parseTicketsCsv(fs.readFileSync(path.resolve(process.argv[2]), "utf8"));
console.log("missing required:", p.missingRequired, "missing optional:", p.missingOptional);
const c = cleanTickets(p, ref);
console.log("rows", c.totalRows, "unique", c.uniqueTickets, "dups removed", c.duplicatesRemoved, "conflicting", c.conflictingDuplicates, "skipped", c.rowsSkipped.length);
console.log("unit", c.unit);
const f = (n: number) => Math.round(n).toLocaleString("en-IN");
console.log("raw", f(c.rawSum), "| dup", f(c.dupSum), "| unit", f(c.unitAdjustment), "| clean", f(c.cleanSum), "| gap", Math.round(c.rawSum - c.dupSum - c.skippedSum - c.unitAdjustment - c.cleanSum));
for (const q of byQuarter(c.refunds, c)) console.log(quarterLabel(q.quarter), f(q.amount), q.count, q.complete ? "" : "(partial)");
const by: Record<string, number> = {}, rep: Record<string, number> = {};
for (const r of c.refunds) { by[r.code] = (by[r.code] || 0) + 1; rep[r.reportedCode || "(blank)"] = (rep[r.reportedCode || "(blank)"] || 0) + 1; }
console.log("coded  ", rep); console.log("rules  ", by);
console.log("settled by rules", c.refunds.filter((r) => r.codeSource === "rules").length, "of", c.refunds.length);
const d = doublePayouts(c.refunds, ref);
console.log("double payouts", d.count, "share", (d.shareOfRefunds * 100).toFixed(1) + "%", "recent", (d.recentShare * 100).toFixed(1) + "%", "value", f(d.total), "per qtr", f(d.perQuarterRunRate), "noteOnly", d.flaggedByNoteOnly);
console.log("issues:"); for (const i of c.issues) console.log(" -", i.kind, i.title, "|", i.detail.slice(0, 140));

// Proxy accuracy: there is no answer key for real data, so compare with agents' *specific* codes
// (anything but the GW-OTHER default). Agents are usually right when they bother to pick a specific code.
let agree = 0, dis = 0, unc = 0; const conf: Record<string, number> = {};
for (const r of c.refunds) {
  if (!r.reportedCode || r.reportedCode === "GW-OTHER") continue;
  const v = classifyByRules(r.message, r.note); // no hint: comparing against the agent code must not be circular
  if (v.code === "UNCLEAR") { unc++; continue; }
  if (v.code === r.reportedCode) agree++; else { dis++; const k = `${r.reportedCode} -> rules:${v.code}`; conf[k] = (conf[k] || 0) + 1; }
}
console.log(`\nvs specific agent codes: agree ${agree}, disagree ${dis}, unclear ${unc}  (agreement among decided: ${(agree / (agree + dis) * 100).toFixed(1)}%)`);
console.log("top disagreements", Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 10));
const gw = c.refunds.filter((r) => r.reportedCode === "GW-OTHER");
const gwm: Record<string, number> = {}; for (const r of gw) gwm[r.code] = (gwm[r.code] || 0) + 1;
console.log("coded GW-OTHER read as:", gwm);
