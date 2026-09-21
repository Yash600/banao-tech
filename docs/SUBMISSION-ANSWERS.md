# Submission form: draft answers

Fill the `[brackets]`, check every claim against what you actually did, then paste into `submission-form.md`. Anything in brackets is something I could not know. Numbers come from the real `tickets.csv`; see `docs/FINDINGS.md`.

---

**1. What did you build, and what business outcome does it move? State the number and the money.**

The Refund Ledger: a web tool (Next.js; runs locally with `npm install && npm run dev`, deployable to Vercel) that takes the helpdesk export and produces monthly refunds by reason code and by agent, with a total that reconciles to the raw file to the rupee, plus a 7-sheet Excel workbook for the board pack. It fixes the legacy-Freshdesk money unit (detected from the data), removes migration duplicates, and re-reads each agent's closing note to correct the over-used GW-OTHER reason code.

**Business goal, from the real data:** cut refunds that also sent the customer a replacement (policy §5: never both) **from 17.2% of refunds (last six months) to under 1%**. That is **about ₹4.1 lakh a quarter today (₹19.6 lakh across the 18 months), so roughly ₹3.9 lakh a quarter recovered**. 362 of 2,340 refunds are affected; 196 of them are visible only in the agent's note, not the "replacement issued" flag.

It also explains the client's own puzzle: the export sums to ₹23.0 crore; after removing 638 duplicate rows and converting legacy paise to rupees it is ₹67.1 lakh, about ₹11.2 lakh a quarter, matching the helpdesk's ~₹11 lakh.

**2. What does one run cost, and what would a month cost at ~650 tickets/week? Show the arithmetic.**

One run: **₹0**. The AI step uses Groq's free tier (`openai/gpt-oss-20b`).
- The real file has 11,600 unique tickets over 18 months; refunds are 2,340 (20.2% of tickets).
- At 650 tickets/week × 4.33 = ~2,800 tickets/month → ~570 refunds/month.
- Keyword rules settle 67% without any call, so the AI sees ~33% ≈ 190 refunds/month, in batches of 40 = ~5 calls/month.
- Estimated ~4,000 tokens per call (not measured on the live service): ~20,000 tokens/month, against a free allowance of 200,000 tokens/day (30 requests/min, 8,000 tokens/min, per Groq's rate-limit page).
- First-time backfill of the whole 18-month file: ~770 refunds = ~20 calls. At 8,000 tokens/min that is roughly 10–15 minutes, once, then cached in the browser.

[Replace the token estimate with the measured figure the app shows when a live run finishes.]

**3. How do you know it works? Sample size, how you checked, error rate, the kind of case it gets wrong.**

Honest split between what is checked and what is not:
- **Checked exactly:** the reconciliation. Raw sum − duplicates − unit correction = cleaned total, gap ₹0 on the real file (12,238 rows) and on 55 edge-case tests (`npm test`).
- **Checked by hand:** I read a random 30 of the 196 double-payouts found only in agent notes. All 30 described money going back plus a new unit (28 explicit, 2 saying only "replacement raised" on a ticket that carries a refund). The other 166 have the agent's own "replacement issued = Y" flag.
- **Checked indirectly, reason codes:** the real file has no answer key, so I cannot give a true error rate. Where agents chose a *specific* (non-default) code, my rules agree with them 89% of the time (1,027 agree, 123 disagree, among refunds the rules could decide). Rules settle 67% of real refunds, leave 18% UNCLEAR and 14% as weak matches for the AI.
- **On the synthetic file, which has an answer key:** rules 91% right, 0% wrong, 9% unclear; refund+replacement 152 of 159 found, 0 false alarms. **This flatters the tool:** I wrote both the notes and the rules.
- **What it gets wrong:** notes that name two causes; "damaged in transit" tickets, which agents sometimes code as dead-on-arrival and sometimes lost-in-transit (54 such disagreements); notes like "see prev" or "done" with a message that gives no reason.
- **How you measure the real error rate:** the in-app spot-check draws a random sample, you mark right or wrong, it reports the rate with a 95% range. **I have not done this on the real file, and I have not run the AI on the live model.** [Do the spot-check and put the number here.]

**4. Did you change, narrow, or push back on the client's ask? [can only raise your score]**

- **Number to move:** Priya's email shows higher refunds were a deliberate, signed-off trade, so I did not target "refunds are too high". I targeted refund+replacement, which breaks a written policy nobody approved.
- **"By agent":** raw rupees mostly reflect team role, so I added refunds per 100 tickets so agents are compared within their own team, and labelled the flags as prompts, not verdicts.
- **Reason codes:** Arjun asked for a summary by reason code. I show both as-coded and corrected, because 42% of refunds are coded GW-OTHER and only ~15 read as goodwill.
- **Crore vs ₹11 lakh:** treated as a reconciliation and shown as a walk.
- **The email thread's explanations:** tested rather than accepted. Priya's "+0.4 CSAT" is +0.03 in the file, and Neha's "Returns Desk does most refunds" is 26%.

**5. What is wrong with what you are handing us? [can only raise your score]**

- The reason-code accuracy on real notes is unmeasured (no answer key), and the AI path has only been run against a local stand-in for Groq, never the live model. The prompt is a single version. [Update if you ran it.]
- The rules were tuned by reading Vireo's real notes, so the 89% agreement is against agents' codes, which are themselves noisy. Some "disagreements" are probably agent errors, not rule errors.
- "Damaged in transit" is genuinely ambiguous between two codes; the tool defers to the agent's specific code when the note fits both.
- Legacy unit is inferred (confirmed by 469 of 643 matches). Duplicates are matched on `ticket_id` only.
- Refund date = ticket creation date; "agent" = resolver, not approver.
- Refund+replacement can over-count when a customer legitimately got a replacement for another order; only 30 of 196 note-only detections were hand-read.
- Calendar quarters, not Indian financial-year quarters.
- The synthetic sample and its accuracy figures are illustrative only.
- No login: a public deployment needs `ACCESS_CODE`, and the real data must never be published.

**6. What did you deliberately leave out, and why that rather than something else?**

SLA-breach credits (₹350 each), transfer costs (₹305), IST-vs-UTC timestamp drift, first-contact resolution and handle time. All are real and in the data, but none is what Arjun asked about, and each needs its own reconciliation. I finished one question properly (refunds: reconciled, explained, testable) rather than several thinly.

**7. Anything you built or found that nobody asked for?**

- Refunds resolved by teams that policy says should not process them (only 26% go through the Returns Desk).
- The double-payout finding, priced at unit cost + ₹340, with the 196 that only show in notes.
- Goodwill-cap (₹500) breaches: 25 refunds, ₹0.9 lakh over.
- A test of Priya's Q4/CSAT claim and Neha's "careful Returns Desk" claim against the file.
- A manufacturing-lot check (null result: nothing stands out).
- Click-through to the tickets behind any number, in-app correction that flows into the totals, the spot-check tool, and a 7-sheet workbook with live formulas.

**8. What did you use AI for?**

- **Claude Code (Claude Sonnet 5):** planning, all of the code, the tests, the synthetic data generator, and drafts of the memo and this form. [Adjust to what is true.]
- **Groq `openai/gpt-oss-20b`:** the app's runtime reader of vague notes. [Say whether you ran it live.]
- **Where it helped:** speed on the pipeline, tests and UI; measuring the phone-layout overflow in the browser; reading Vireo's real notes to rebuild the rules (unclear reasons fell from 65% to 18%).
- **Where it wasted time or went wrong:** the first version was built and tuned on synthetic data and gave 100% accuracy, which meant nothing (I wrote both sides). When the real file arrived it showed the synthetic story was wrong in several places (e.g. it said the Returns Desk drove double payouts; in reality it is Chat and Logistics). A "recovered per quarter" number used the wrong time window until I caught it. Browser screenshots were unreliable in the sandbox.
- **Thrown away:** the Python + Render plan; sending every ticket to the LLM; the `xlsx` package (audit warning); the 100% claim; the synthetic-based narrative.
- **Cost:** [what you actually spent on Claude]. Groq: free tier.
- **Screen recording:** [link]

**9. Your public Google Drive link:** [link]

**10. Someone picks this up on Monday and you are unreachable. The three things they need to know.**

1. **Do the spot-check before quoting reason codes.** Load the real `tickets.csv`, check the legacy unit on "Do the books balance?" (÷100), add a free Groq key and run the AI on the vague notes, then use the spot-check on 30+ refunds. The reconciliation and the double-payout finding are solid; the reason-code split is an estimate until then.
2. **The number to move is refund + replacement (17.2% of recent refunds, ~₹4.1 lakh a quarter).** Most cases are in Chat Frontline and Logistics, not the Returns Desk. The fix is a helpdesk rule blocking "replacement issued" when a refund amount is present.
3. **Never publish the real data or an open key.** The real file lives only in `private/` (git-ignored). For Vercel set `GROQ_API_KEY` and `ACCESS_CODE`; the deployed URL is public even though the app reads files in the browser.

**11. Honest hours spent:** [one number]

**12. GitHub repo:** [public URL]
