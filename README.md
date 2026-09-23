# The Refund Ledger

A small web tool for Vireo Audio's Finance Controller. Drop in the helpdesk export and get **monthly refunds by reason code and by agent**, with a total that reconciles to the file, as a page you can read and an Excel workbook you can paste into the board pack.

> **Status of the data.** The pack's `tickets.csv` arrived after the tool was first built, so the app was designed and tested twice: first on a **synthetic** file I generated to the README layout (`data/tickets.synthetic.csv`, the "Try the synthetic sample" button), then run end to end on the **real** export (12,238 rows). The real file is client data: it is **not in this repo** (`private/` is git-ignored) and the sample button never loads it. The findings from the real file are in [`docs/FINDINGS.md`](docs/FINDINGS.md). What is and is not verified is under [What is not proven](#what-is-not-proven).

## Run it (clean machine)

Needs **Node.js 20 or newer**. Nothing else: no database, no Python.

```bash
npm install
npm run dev
```

Open https://banao-tech-eight.vercel.app and press **Try the synthetic sample**.

To use the real export, press **Choose the CSV** and pick `tickets.csv`. The file is read in your browser and never uploaded.

### Optional: let an AI read the vague notes

Without a key the tool still works, using keyword rules only. To let an AI read the notes the rules cannot settle:

1. Get a free key at <https://console.groq.com>.
2. `cp .env.example .env.local` and paste the key after `GROQ_API_KEY=`, then restart `npm run dev`. Or skip the file and paste the key into **Key & settings** in the page (kept in that browser tab only).

Free-tier limits at time of writing (Groq's rate-limit page): 30 requests/min, 8,000 tokens/min, 200,000 tokens/day. The tool batches 40 tickets per call, waits and retries when rate-limited, and remembers every answer in the browser, so re-running a file costs nothing.

## What it does

| Section | What you get |
|---|---|
| **1 Load** | Drag-and-drop CSV, clear errors for wrong or broken files |
| **2 Books balance?** | Waterfall from the file's raw sum to the cleaned total, to the rupee. Quarterly totals against the helpdesk's own ~₹11 lakh. The legacy money unit is **detected from the data**, with a manual override |
| **3 By reason, by month** | Chart and table by reason code, either *corrected* from the notes or *as agents coded them*. Click any figure to see the tickets behind it |
| **4 By agent** | Rupees, refund rate per 100 tickets, "habitual GW-OTHER" and double-payout flags. Sortable, filterable, month-by-month view |
| **5 Refund + replacement** | Every ticket where the customer got both (policy §5 forbids it), priced at unit cost + ₹340 |
| **6 Testing the stories** | Checks Priya's Q4/CSAT claim and Neha's "Returns Desk is careful" claim against the file, plus goodwill-cap breaches and suspicious manufacturing lots |
| **7 Trust** | Error rate vs an answer key (sample only), a **spot-check tool** for real data with confidence intervals, and a plain list of what is known to be off |
| **Excel export** | 7-sheet workbook: reconciliation, by reason (corrected and as coded), by agent by month, refund+replacement list, reason changes, data issues and assumptions. Totals are live formulas |

## How the numbers are made trustworthy

- **Duplicates.** A repeated `ticket_id` is one ticket; the current-helpdesk copy wins. Copies that disagree are flagged.
- **Legacy money.** For legacy Freshdesk refunds that match an order, the tool tests which divisor (1, 10, 100, 1000) makes the refund equal the order value, and only accepts one that clearly wins. If too few match, it says so and assumes paise, marked as an assumption.
- **Reason codes.** The first dropdown option (GW-OTHER) is over-used, so each refund's reason is re-read from the agent's closing note, then the customer message. Keyword rules settle the clear cases instantly and explain themselves; the LLM sees only the rest. If nothing says why, the answer is **UNCLEAR**, never a guess.
- **Blank CSAT** is "no response" and excluded from averages, not treated as zero.
- **Reconciliation identity:** raw sum − duplicates − unplaceable rows − unit correction = cleaned total. It is asserted in the tests.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Run the app locally |
| `npm run build && npm start` | Production build |
| `npm test` | 55 edge-case checks (money formats, dates, duplicates, unit inference, refund+replacement wording, 20,000-row speed, hostile text) |
| `npm run eval` | Accuracy of the tool against the synthetic answer key |
| `npm run generate` | Regenerate the synthetic tickets (seeded, reproducible) |
| `npx tsx scripts/real-run.ts private/tickets.real.csv` | Run the pipeline on a real export and print a summary (put the file in `private/`, which is git-ignored) |

## Deploy to Vercel

It is a plain Next.js app, so `vercel` from this folder works and no separate backend host is needed. Set `GROQ_API_KEY` (and `ACCESS_CODE`, so strangers cannot spend your quota) in the project's environment variables. All heavy work happens in the browser; the only server code is a thin route that holds the key and calls Groq in small batches, which keeps each request well inside serverless time limits. **Do not publish real Vireo data on a public URL.**

## Layout

```
app/                 the page and its sections (React components)
app/api/classify     the only server code: holds the Groq key, one batch per request
lib/csv.ts           tolerant CSV, money and date parsing
lib/pipeline.ts      de-duplication, unit detection, refund records, data-issue log
lib/rules.ts         keyword classifier and refund+replacement detector
lib/classify.ts      batching, rate-limit retry and caching for the LLM pass
lib/analyze.ts       every table and finding
lib/export.ts        Excel workbook
scripts/             generator, accuracy check, edge-case tests
data/ref, public/ref the orders, agents and products files from the pack
```

## Decisions I made where the brief was silent

- **Calendar quarters**, not Indian financial-year quarters. Easy to switch if the board pack uses FY.
- **A refund belongs to the month its ticket was created**, because the file has no refund-issued date.
- **"By agent" means the resolving agent** (`agent_id`), as the README defines it, and agents are matched by id never by name.
- **The legacy unit is inferred, not assumed**, because the policy says only "its own native unit".
- **The business number is the refund-plus-replacement double payout**, not "refunds are too high". Priya's email shows higher refunds were a deliberate, agreed trade, so arguing against the total would be the wrong fight. Paying twice for one problem breaks a written policy and nobody signed off on it.

## What is not proven

- **Reason-code accuracy on the real notes has no answer key.** The real file has no true reasons, so nothing here can say "94% correct". The evidence is indirect: the keyword rules settle 67% of real refunds, leave 18% unclear, and agree with agents' *specific* (non-default) codes 89% of the time where they decide; the double-payout detector was read by hand on a random 30 of its detections (all 30 described a refund with a new unit, 28 explicitly). The spot-check tool in section 7 is how to get a real error rate: do it before quoting reason-code numbers.
- **The AI path has never been run against the live Groq model.** Batching, 429 retry and caching are tested against a local stand-in; the model's actual answers, its token use and the prompt's quality are untested. On the real file about 770 refunds (33%) would go to it, roughly 20 batches.
- **The synthetic-sample accuracy flatters the tool** (I wrote the notes and the rules). It proves the mechanics, not real-world accuracy.
- The unit correction (÷100) is inferred, and on the real file 469 of 643 matchable legacy refunds confirm it; 174 do not equal an order value at all (partial refunds), which is expected.
- The tool cannot say who *approved* a refund, only who resolved the ticket. Duplicate detection is by `ticket_id` only. A refund + replacement can over-count when a customer legitimately got a replacement for another order.

## Left out on purpose

SLA-breach credits (₹350 each), transfer costs, timezone drift between IST and UTC timestamps, first-contact resolution, and handle time are all in the policy and the data, but none of them is what Arjun asked about. The refund summary, its reconciliation and the double-payout finding come first; the rest is a follow-on.
