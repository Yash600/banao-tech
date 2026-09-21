# Findings from the real export

Source: the pack's `tickets.csv` (12,238 rows, 1 Jan 2025 – 30 Jun 2026), run through this tool. Reproduce with `npx tsx scripts/real-run.ts <path>` and `npx tsx scripts/real-full.ts <path>`.

## 1. The crore versus the ₹11 lakh: solved, and it adds up

| Step | Rupees |
|---|---|
| Sum of the refund column as exported | ₹23,01,24,081 (₹23.0 crore) |
| − 638 duplicate rows (migration re-import) | −₹3,61,01,100 |
| − legacy Freshdesk money converted (÷100) | −₹18,73,13,049 |
| **Refunds, cleaned (2,340 refunds)** | **₹67,09,932** |
| Gap | ₹0 |

The legacy unit was **inferred, not assumed**: 469 of 643 legacy refunds that match an order equal the order value only after dividing by 100 (paise). The cleaned quarterly totals are ₹6.1 lakh, ₹7.3 lakh, ₹12.1 lakh, ₹16.3 lakh, ₹12.6 lakh and ₹12.8 lakh. The average of the six full quarters is **₹11.2 lakh**, which is the helpdesk report's "around ₹11 lakh". Sameer's number was right; Arjun's export summed mixed units and repeated rows.

## 2. The reason codes are unreliable

- Agents coded **991 of 2,340 refunds (42%) as GW-OTHER**, the first option in the dropdown.
- Reading their own closing notes, the keyword rules find only **15** that are genuinely goodwill. Another 233 cannot be decided from the text. The rest are returns (278), cancellations (120), warranty (25) and others.
- Over all refunds, the agent's code matches what the note says on **45%**.
- About **₹28.4 lakh** of refund value sits under a different real reason than the one coded as goodwill.

## 3. Refund and replacement on the same ticket: the number to move

- **362 refunds (15.5%) also sent the customer a replacement**, against policy §5. In the last six months it is **17.2%**.
- Cost: **₹19.6 lakh** across the file (₹13.0 lakh refunded + ₹6.7 lakh of units and shipping at unit cost + ₹340). At the recent pace about **₹4.1 lakh a quarter**.
- **196 of them are visible only in the agent's note**, not in the "replacement issued" flag (166 have the flag).
- Where they sit: Chat Frontline 105, Logistics 104, Escalations & Warranty 47, Email Frontline 42, Returns Desk 31, Voice Frontline 24, Billing 9. One agent (A3030, Logistics) accounts for 47.
- **Goal:** cut this from 17.2% to under 1%, recovering about **₹3.85 lakh a quarter**.
- Evidence quality: I read a random 30 of the 196 note-only detections; all 30 described money going back plus a new unit (28 explicit, 2 saying only "replacement raised" on a ticket that carries a refund). The full set was not hand-checked.

## 4. What the file says about the email thread

- **Priya: "refunds rose because the frontline stopped arguing; CSAT rose 0.4."** From Jul–Sep to Oct–Dec 2025 refunds rose by ₹4.2 lakh. The frontline explains **48%** of that rise and the Returns Desk **21%**. So the frontline story is roughly half right. **CSAT moved +0.03** on the previous quarter and about 0.00 on the earlier average (3.48 → 3.51). The file does not show +0.4; ask where that figure is measured.
- **Neha: "the Returns Desk is very careful, and does most of the refunds."** The Returns Desk resolved **26% of refunds** (612 of 2,340) and 25% of the rupees. Billing (592), Chat Frontline (387) and Logistics (356) resolve most of the rest, although policy §6 says the Returns Desk handles the large majority. And only **31 of the 362** double payouts are the Returns Desk's: the problem is elsewhere.
- **Goodwill cap (policy §5, ₹500):** 25 refunds read as goodwill exceed it, ₹0.9 lakh above the cap.
- **Bad manufacturing lots:** none stands out. This was checked and is a null result.

## What is uncertain

- Reason codes were re-read by keyword rules (67% settled, 18% unclear, 14% weak matches) and are not yet spot-checked or AI-read on the real file. Read the reason-code numbers as good estimates, not audited figures, until the spot-check in the app has been done.
- "Agent" is the resolver, not the approver.
- A refund is placed in the month its ticket was created, because the file has no refund-issued date.
