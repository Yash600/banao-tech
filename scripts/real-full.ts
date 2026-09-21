/** Exercise every analysis + the Excel export on a real file, with timings.  npx tsx scripts/real-full.ts private/tickets.real.csv */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { parseTicketsCsv } from "../lib/csv";
import { buildReference } from "../lib/reference";
import { cleanTickets } from "../lib/pipeline";
import { badLots, byAgent, byQuarter, doublePayouts, markCapBreaches, q4Test, reclassification } from "../lib/analyze";
import { buildWorkbook } from "../lib/export";

const ROOT = path.resolve(__dirname, "..");
const csv = (f: string) => Papa.parse<Record<string, string>>(fs.readFileSync(path.join(ROOT, "data/ref", f), "utf8"), { header: true, skipEmptyLines: true }).data;
const ref = buildReference(csv("agents.csv"), csv("products.csv"), csv("orders.csv"));
const T = (label: string, t0: number) => console.log(label.padEnd(22), (Date.now() - t0) + " ms");
let t0 = Date.now();
const text = fs.readFileSync(path.resolve(process.argv[2]), "utf8");
const parsed = parseTicketsCsv(text); T("parse CSV", t0);
t0 = Date.now(); const clean = cleanTickets(parsed, ref); T("clean + rules", t0);
const refunds = markCapBreaches(clean.refunds);
t0 = Date.now();
const a = byAgent(refunds, ref), q = byQuarter(refunds, clean), d = doublePayouts(refunds, ref), t4 = q4Test(refunds, clean), lots = badLots(refunds, ref), rc = reclassification(refunds);
T("all analyses", t0);
console.log("\nagents", a.length, "| top:", a.slice(0, 4).map((x) => `${x.name} ${x.team} ₹${Math.round(x.amount)} dbl=${x.doubles}`).join(" ; "));
console.log("Q4 test:", t4.verdict);
console.log("frontline share of rise", t4.frontlineShareOfRise, "returns", t4.returnsShareOfRise);
console.log("csat by quarter:", t4.rows.map((r) => `${r.label}:${r.csat?.toFixed(2)}`).join(" | "));
console.log("bad lots:", lots.lots.slice(0, 4), "baseline", lots.baseline.toFixed(3));
console.log("cap breaches:", refunds.filter((r) => r.capBreach).length, "GW coded", rc.gwReportedCount, "of which really goodwill", rc.trulyGoodwill.count, "agreement", (rc.agreementRate * 100).toFixed(0) + "%");
console.log("double by agent:", d.byAgent.slice(0, 5).map((x) => `${x.name}(${x.team}) ${x.count}`).join(" ; "));
console.log("double by team share:", Object.entries(refunds.filter((r) => r.doublePayout).reduce((m: Record<string, number>, r) => ((m[r.team] = (m[r.team] || 0) + 1), m), {})));
console.log("unit rows / quarters:", q.map((x) => x.label + " " + Math.round(x.amount / 1e5) + "L").join(", "));

(async () => {
  t0 = Date.now();
  const blob = await buildWorkbook({ clean, refunds, ref, helpdeskQuarterly: 1_100_000, dataLabel: "tickets.csv" }); T("build Excel", t0);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await blob.arrayBuffer()) as never);
  console.log("sheets:", wb.worksheets.map((w) => `${w.name}(${w.rowCount})`).join(" | "), "| bytes", blob.size);
})();
