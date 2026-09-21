/**
 * Synthetic ticket generator.
 *
 * The real tickets.csv was NOT in the pack, so this builds a stand-in that follows the
 * README schema and reproduces the traps described in email-thread.txt / support-policy.pdf.
 * Everything it produces is fake. It writes:
 *   data/tickets.synthetic.csv  - what the tool ingests (README columns only)
 *   data/tickets.truth.csv      - the answer key (true reason, double payout) for accuracy tests
 *
 * Run: npm run generate
 */
/* eslint-disable @typescript-eslint/no-explicit-any, no-var, prefer-const */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) =>
  Papa.parse<Record<string, string>>(fs.readFileSync(path.join(ROOT, "data/ref", f), "utf8"), {
    header: true,
    skipEmptyLines: true,
  }).data;

// ---------- seeded RNG so the file is reproducible ----------
let seed = 20260921;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const wpick = <T,>(pairs: [T, number][]): T => {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const chance = (p: number) => rnd() < p;

const orders = read("orders.csv");
const agents = read("agents.csv");
const products = Object.fromEntries(read("products.csv").map((p) => [p.sku, p]));
const customers = read("customers.csv");
const careById = Object.fromEntries(customers.map((c) => [c.customer_id, c.care_plus]));

const CUTOVER = new Date("2025-09-14T00:00:00+05:30").getTime();
const START = new Date("2025-01-01T00:00:00+05:30").getTime();
const END = new Date("2026-06-30T23:59:59+05:30").getTime();
const DAY = 86400000;

const teamAgents = (team: string) => agents.filter((a) => a.team === team).map((a) => a.agent_id);
const FRONT = [...teamAgents("Chat Frontline"), ...teamAgents("Email Frontline"), ...teamAgents("Voice Frontline")];

// ---------- text banks ----------
type Bank = { msg: string[]; note: string[] };
const BANKS: Record<string, Bank> = {
  "DOA-REPL": {
    msg: [
      "Received my {p} yesterday and it won't switch on at all. Want my money back.",
      "{p} is dead on arrival. Left side not charging, box is 3 days old. Refund please.",
      "Bought {p} from {ch}, doesn't power up out of the box. I don't want another one, just refund.",
      "the {p} arrived faulty. no lights, no pairing. I want a full refund",
      "Item delivered 2 days back. Not working, completely dead. Please return and refund.",
      "DOA unit. Tried 3 cables. Nothing. Refund me.",
    ],
    note: [
      "Confirmed DOA within 7 days. Customer opted for refund over replacement. Refund raised.",
      "Unit dead on arrival, customer chose refund. Pickup scheduled, refund processed.",
      "DOA verified by video. Full refund issued at customer request.",
      "Dead on arrival, cx does not want replacement. Refunded to original payment.",
      "Not powering on, delivered <7d. Refund as per DOA policy.",
    ],
  },
  "LOST-TRANSIT": {
    msg: [
      "My order shows delivered but I never got it. Please help.",
      "Courier marked it delivered, nothing came. It's been 10 days.",
      "Package lost in transit, tracking stuck at hub since last week.",
      "Order never arrived. Tracking says undelivered, returned to origin. Want refund.",
      "Still haven't received my {p}. Tracking hasn't moved in a week.",
    ],
    note: [
      "Logistics confirmed shipment lost. Reshipment not possible (OOS) so refund issued.",
      "Courier POD disputed, parcel undelivered. Refund raised.",
      "Lost in transit per carrier claim. Refunded.",
      "Shipment returned to origin, customer did not want reship. Refund processed.",
      "Undelivered / RTO. Refund done to source.",
    ],
  },
  "DUP-PAYMENT": {
    msg: [
      "I was charged twice for the same order! Please refund one payment.",
      "Money got deducted two times, only one order placed.",
      "Payment failed on your site but money left my bank account. Please reverse.",
      "Double charge on my card for {p}. Order number is same.",
      "amount debited but order not confirmed, then I retried and paid again",
    ],
    note: [
      "Duplicate payment confirmed with gateway. Second charge refunded.",
      "Failed payment, amount debited. Reversal initiated.",
      "Billing verified double debit. Excess refunded.",
      "PG shows two captures for one order. Refund of duplicate raised.",
      "Payment gateway duplicate, refunded excess amount.",
    ],
  },
  CANCEL: {
    msg: [
      "Please cancel my order, I ordered by mistake.",
      "Want to cancel {p} order before it ships. Found it cheaper elsewhere.",
      "Cancel my order asap, changed my mind.",
      "Ordered wrong colour, cancel and refund pls",
      "cancelling order. hasn't shipped yet right?",
    ],
    note: [
      "Order cancelled before dispatch. Full refund initiated.",
      "Cancellation accepted, not yet shipped. Refunded.",
      "Cx cancelled pre-dispatch, refund raised.",
      "Cancelled at warehouse stage, amount refunded to source.",
    ],
  },
  "PRICE-ADJ": {
    msg: [
      "The coupon didn't apply at checkout but it was valid. I paid extra.",
      "Price dropped by Rs 500 two days after I bought {p}. Can you adjust?",
      "Was promised a discount code, got charged full price.",
      "Sale price mismatch on {ch} vs what I paid. Want the difference back.",
    ],
    note: [
      "Coupon not applied due to a site bug. Difference refunded.",
      "Price adjustment given, within 7 days of purchase.",
      "Promo code error, price difference credited back.",
      "Coupon adjustment processed as per pricing team.",
    ],
  },
  "RETURN-QC-OK": {
    msg: [
      "I'd like to return {p}, it doesn't fit my ears and I'm within the return window.",
      "Sending back my {p}. Not what I expected. Please arrange pickup.",
      "Want to return the speaker. Sound isn't what I wanted.",
      "Return request for {p}, unopened mostly. Please refund after pickup.",
      "Returning the watch, strap is uncomfortable. Refund once you get it.",
    ],
    note: [
      "Return picked up, received at warehouse, QC passed. Refund issued.",
      "Item received back, QC OK, refunded.",
      "Return QC cleared. Amount refunded to original mode.",
      "Pickup done, product checked and passed QC, refund raised.",
      "Return received in good condition. Refund processed.",
    ],
  },
  "WTY-BUYBACK": {
    msg: [
      "My {p} has stopped working again, third repair. Can I just get money back?",
      "{p} in warranty keeps failing. Repaired twice already. I'd rather have a buyback.",
      "Battery dies within an hour, been to the service centre twice. Want buyback.",
    ],
    note: [
      "Tier 2 approved warranty buy-back after repeat failure. Buyback amount refunded.",
      "Repeated in-warranty fault, buy-back approved and processed.",
      "Warranty buyback: device could not be repaired. Refunded as per policy.",
    ],
  },
  "GW-OTHER": {
    msg: [
      "I've been waiting long for a reply on my last ticket. Very disappointed.",
      "Your support took ages to respond, I want some compensation.",
      "Bad experience with delivery delay. Something for the trouble?",
      "Had to contact you three times for one issue. Not happy.",
    ],
    note: [
      "Goodwill gesture for poor experience, approved by TL.",
      "Apologised for delay and gave goodwill refund.",
      "Compensated for repeated contacts. Goodwill credit approved.",
      "Goodwill as customer was upset about wait time.",
    ],
  },
};

// Harder, differently-worded notes (typos, shorthand, Hinglish). Used for ~20% of refunds so the
// rules cannot simply memorise the templates above.
const HARD: Record<string, string[]> = {
  "DOA-REPL": ["box opened, piece is totally kaput from day 1. money back given", "unit nahi chal raha out of box, cx wants paisa wapas, done", "faulty from the start (dead on arival), cust refused exchange, amt returned", "item ded when opened. refnd issued"],
  "LOST-TRANSIT": ["courier says delivered but cx says no. ran claim, cant locate parcel. money returned", "parcel gum ho gaya, no trace with partner. amount sent back", "never reached cx, stuck at hub, we refunded rather than wait", "pkg didnt make it to the customer; reimbursed"],
  "DUP-PAYMENT": ["cx paid 2x via upi, one txn should not have gone through. sent back the extra", "bank shows 2 debits for 1 order id, returned one", "txn failed at gateway but debit happened; credited back", "paid twice, corrected"],
  CANCEL: ["cx changed mind same day, order hadnt left the warehouse. money returned", "stopped the order in time - not dispatched. amount back to card", "order pulled before pickup by courier, cx refunded"],
  "PRICE-ADJ": ["pricing team OKd difference after price cut within window, sent Rs back", "offer wasnt honoured at checkout - gave the diff back", "sale discount missed, paid cx the gap"],
  "RETURN-QC-OK": ["cx sent it back, warehouse inspected - all fine. amount returned", "returned product looked good on inspection, money released", "reverse pickup complete, item ok, refunded"],
  "WTY-BUYBACK": ["device repaired 2x already still faulty, tier 2 signed off on taking it back for money", "in warranty, cannot fix, we bought it back from cx", "repeat hardware issue - approved paying cx instead of another repair"],
  "GW-OTHER": ["cx was cross about the wait, gave a little something to smooth things", "sorry gesture, TL ok'd", "cx irritated with the runaround so we credited a small amount"],
};
const VAGUE_NOTES = ["Refund processed.", "Done as requested.", "Refunded.", "Resolved, refund given.", "cx happy", "As discussed with customer.", "Processed."];
const REPL_ADD = [
  " Also sent a new unit.",
  " Replacement dispatched as well to keep customer happy.",
  " New piece shipped separately.",
  " Fresh unit sent from stock too.",
];

const NON_REFUND: [string, string[], string[]][] = [
  ["how-to", ["How do I pair {p} with my phone? Blinking red only.", "Unable to connect {p} to the app.", "Firmware update fails at 60%."], ["Guided through reset and re-pair. Working now.", "Walked customer through app update. Issue closed.", "Explained pairing steps, resolved."]],
  ["delivery", ["Where is my order? Tracking not updating.", "When will {p} be delivered?", "Delivery agent asking for extra charge."], ["Shared updated tracking, courier ETA confirmed.", "Escalated to logistics, delivered next day.", "Informed customer of delay; delivered."]],
  ["warranty", ["Left earbud crackling after 4 months.", "{p} screen flickering, in warranty.", "Battery draining fast on my {p}."], ["Raised RMA, repair done in service centre. Customer satisfied.", "Warranty replacement approved by Tier 2.", "Sent for repair under warranty. Returned to customer."]],
  ["invoice", ["Need GST invoice for my order.", "Invoice shows wrong name, please correct.", "Please resend my order invoice."], ["Sent corrected invoice on email.", "GST invoice shared.", "Invoice reissued."]],
  ["product-info", ["Is {p} compatible with iPhone?", "What is the battery life on {p}?", "Does {p} come with a charger in the box?"], ["Shared spec details with customer.", "Answered compatibility question.", "Info provided, no further action."]],
];

const CATS = ["Product fault", "Delivery", "Billing", "Returns", "Warranty", "How-to", "Account"];
const REASONS = Object.keys(BANKS);

// per-agent tendency to leave the dropdown on its first option (GW-OTHER)
const defaultBias: Record<string, number> = {};
for (const a of agents) defaultBias[a.agent_id] = 0.25 + rnd() * 0.25;
for (const id of ["A3036", "A3037", "A3005", "A3012", "A3018"]) defaultBias[id] = 0.8; // habitual dropdown-leavers
const lazyAgents = new Set(["A3036", "A3037"]);

// ---------- build tickets ----------
type Row = Record<string, string>;
const tickets: Row[] = [];
const truth: Row[] = [];
let tid = 400000;

const fmt = (ms: number) => {
  // helpdesk displays IST
  const d = new Date(ms + 330 * 60000);
  return d.toISOString().replace("T", " ").slice(0, 19);
};
const fmtUTC = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const clean = (s: string, p: any, ch: string) => s.replace("{p}", p.product_name).replace("{ch}", ch);

function refundAmount(reason: string, order: Row | undefined, sku: string): number {
  const price = order ? Number(order.order_value_inr) : Number(products[sku].retail_price_inr);
  switch (reason) {
    case "GW-OTHER":
      return chance(0.07) ? pick([650, 800, 1000]) : pick([150, 200, 250, 300, 350, 400, 500]); // occasional cap breach
    case "PRICE-ADJ":
      return pick([100, 200, 300, 500, 600, 750]);
    case "WTY-BUYBACK":
      return Math.round(price * (0.4 + rnd() * 0.4));
    case "RETURN-QC-OK":
      return chance(0.15) ? Math.round(price * 0.9) : price;
    default:
      return price;
  }
}

const weekMult = (t: number) => {
  const m = new Date(t).toISOString().slice(0, 7);
  return m >= "2025-10" && m <= "2025-12" ? 1.25 : 1; // Q4 volume bump
};

function addTicket(order: Row | undefined, created: number, forceRefund: string | null) {
  const sku = order ? order.sku : pick(Object.keys(products));
  const custId = order ? order.customer_id : pick(customers).customer_id;
  const p = products[sku];
  const ch = order ? order.channel : "vireo.in";
  const legacy = created < CUTOVER;
  const q4 = created >= new Date("2025-10-01T00:00:00+05:30").getTime() && created <= new Date("2025-12-31T23:59:59+05:30").getTime();
  const afterQ4 = created >= new Date("2025-10-01T00:00:00+05:30").getTime();

  // decide ticket type
  let trueReason: string | null = forceRefund;
  if (!trueReason) {
    const refundP = afterQ4 ? 0.2 : 0.15;
    if (chance(refundP)) {
      trueReason = wpick<string>([
        ["DOA-REPL", 30], ["RETURN-QC-OK", 20], ["LOST-TRANSIT", 12], ["CANCEL", 10],
        ["DUP-PAYMENT", 8], ["PRICE-ADJ", 8], ["GW-OTHER", q4 ? 12 : 7], ["WTY-BUYBACK", 5],
      ]);
    }
  }

  const channel = wpick<string>([["chat", 45], ["email", 28], ["voice", 15], ["social", 12]]);
  let team: string;
  let category: string;
  let msg: string;
  let note: string;
  let refundInr: number | null = null;
  let agentCode = "";
  let replacement = "N";
  let double = "N";

  if (trueReason) {
    const bank = BANKS[trueReason];
    msg = clean(pick(bank.msg), p, ch);
    note = pick(bank.note);
    const teamPairs: Record<string, [string, number][]> = {
      "DOA-REPL": [["Returns Desk", 80], ["Escalations & Warranty", 8], ["Chat Frontline", 12]],
      "RETURN-QC-OK": [["Returns Desk", 90], ["Chat Frontline", 10]],
      "LOST-TRANSIT": [["Logistics", 45], ["Returns Desk", 45], ["Chat Frontline", 10]],
      CANCEL: [["Billing", 30], ["Returns Desk", 55], ["Chat Frontline", 15]],
      "DUP-PAYMENT": [["Billing", 85], ["Returns Desk", 15]],
      "PRICE-ADJ": [["Billing", 60], ["Chat Frontline", 25], ["Email Frontline", 15]],
      "WTY-BUYBACK": [["Escalations & Warranty", 100]],
      "GW-OTHER": [["Chat Frontline", 55], ["Email Frontline", 30], ["Voice Frontline", 15]],
    };
    team = wpick(teamPairs[trueReason]);
    category = trueReason === "DUP-PAYMENT" || trueReason === "PRICE-ADJ" ? "Billing" : trueReason === "LOST-TRANSIT" ? "Delivery" : trueReason === "WTY-BUYBACK" ? "Warranty" : trueReason === "GW-OTHER" ? "Account" : "Returns";
    refundInr = refundAmount(trueReason, order, sku);
    if (order && Number(order.qty) === 2 && ["DOA-REPL", "RETURN-QC-OK", "CANCEL", "LOST-TRANSIT", "DUP-PAYMENT"].includes(trueReason)) refundInr = Number(order.order_value_inr);
    // notes that say nothing useful
    if (chance(0.2)) note = pick(HARD[trueReason]);
    else if (chance(0.13)) note = pick(VAGUE_NOTES);
    if (chance(0.02)) { note = ""; }
    // Agent picks the dropdown code
    // resolved by
    const pool = teamAgents(team);
    var agentId = wpick<string>(pool.map((id) => [id, lazyAgents.has(id) ? 3 : 1] as [string, number]));
    const bias = defaultBias[agentId] * (afterQ4 && FRONT.includes(agentId) ? 1.25 : 1);
    if (trueReason !== "GW-OTHER" && chance(Math.min(0.92, bias))) agentCode = "GW-OTHER";
    else if (chance(0.04)) agentCode = pick(REASONS.filter((r) => r !== trueReason));
    else agentCode = trueReason;
    // refund + replacement double payout (policy breach)
    const doubleP = afterQ4 && lazyAgents.has(agentId) ? 0.28 : agentId === "A3038" && afterQ4 ? 0.06 : 0.01;
    if (["DOA-REPL", "RETURN-QC-OK", "LOST-TRANSIT"].includes(trueReason) && chance(doubleP)) {
      double = "Y";
      replacement = chance(0.85) ? "Y" : "N"; // agents forget to tick the flag
      if (chance(0.55)) note += pick(REPL_ADD);
    }
    var agent = agentId;
  } else {
    const [cat, msgs, notes] = pick(NON_REFUND);
    msg = clean(pick(msgs), p, ch);
    note = pick(notes);
    team = wpick<string>([["Chat Frontline", 40], ["Email Frontline", 22], ["Voice Frontline", 12], ["Logistics", 10], ["Billing", 6], ["Escalations & Warranty", 7], ["Returns Desk", 3]]);
    category = cat === "how-to" ? "How-to" : cat === "delivery" ? "Delivery" : cat === "warranty" ? "Warranty" : cat === "invoice" ? "Billing" : "Account";
    var agent = pick(teamAgents(team));
    if (cat === "warranty" && chance(0.35)) replacement = "Y"; // legit warranty replacement, no refund
  }

  // timings
  const target = { chat: 15, voice: 120, social: 240, email: 480 }[channel]! * 60000;
  const late = chance(afterQ4 ? 0.2 : 0.14);
  const respMs = late ? target * (1.2 + rnd() * 3) : target * rnd() * 0.9;
  const first = created + respMs;
  const status = wpick<string>([["resolved", 80], ["closed", 15], ["open", 3], ["pending", 2]]);
  const resolvedMs = first + (0.3 + rnd() * 30) * 3600000;
  const resolved = status === "open" || status === "pending" ? "" : legacy ? fmtUTC(resolvedMs) : fmt(resolvedMs);

  let csat = "";
  if (status !== "open" && status !== "pending" && chance(0.45)) {
    let base = 3.7 + (afterQ4 ? 0.4 : 0) - (late ? 0.8 : 0) + (trueReason === "GW-OTHER" || agentCode === "GW-OTHER" ? 0.3 : 0);
    csat = String(Math.max(1, Math.min(5, Math.round(base + (rnd() - 0.5) * 2.4))));
  }

  const amountStr = (() => {
    if (refundInr == null) return "";
    if (legacy) return String(Math.round(refundInr * 100)); // Freshdesk native unit (paise)
    return chance(0.3) ? refundInr.toFixed(2) : String(refundInr);
  })();

  const id = `T${++tid}`;
  const row: Row = {
    ticket_id: id,
    created_at: fmt(created),
    first_response_at: fmt(first),
    resolved_at: resolved,
    status,
    channel,
    customer_id: custId,
    order_id: order && !chance(0.12) ? order.order_id : "",
    product_sku: sku,
    category: chance(0.3) ? pick(CATS) : category, // bot tag: often wrong before re-tag
    priority: wpick<string>([["Low", 25], ["Normal", 60], ["High", 15]]),
    assigned_team: chance(0.15) ? pick(["Chat Frontline", "Email Frontline", "Voice Frontline"]) : team,
    agent_id: agent!,
    transfers: legacy ? "" : String(wpick<number>([[0, 65], [1, 25], [2, 8], [3, 2]])),
    csat_score: csat,
    refund_amount_inr: amountStr,
    refund_reason_code: refundInr == null ? "" : agentCode,
    replacement_issued: replacement,
    customer_message: msg,
    agent_notes: note,
    source_system: legacy ? "legacy_fd" : "helpdesk",
  };
  tickets.push(row);
  truth.push({
    ticket_id: id,
    true_reason: trueReason ?? "",
    agent_code: refundInr == null ? "" : agentCode,
    double_payout: double,
    true_refund_inr: refundInr == null ? "" : String(refundInr),
    care_plus: careById[custId] ?? "",
  });
  return row;
}

// refund tickets from real orders; bad Pulse 2 lot spikes DOA returns
const BAD_LOTS = new Set(["PL2-2509-1", "PL2-2509-2", "PL2-2509-3"]);
for (const o of orders) {
  const od = new Date(o.order_date + "T12:00:00+05:30").getTime();
  const created = od + (2 + Math.floor(rnd() * 40)) * DAY + Math.floor(rnd() * DAY);
  if (created < START || created > END) continue;
  const badLot = BAD_LOTS.has(o.lot_code);
  if (chance(badLot ? 0.55 : 0.5 * weekMult(created))) {
    addTicket(o, created, badLot && chance(0.6) ? "DOA-REPL" : null);
  }
}
// general tickets with no order
for (let i = 0; i < 2500; i++) {
  const t = START + rnd() * (END - START);
  addTicket(undefined, Math.floor(t), null);
}
tickets.sort((a, b) => a.created_at.localeCompare(b.created_at));

// re-import duplicates: ~5% of legacy rows also appear under helpdesk source
const dups: Row[] = [];
for (const r of tickets) {
  if (r.source_system === "legacy_fd" && chance(0.05)) {
    const twin: Row = { ...r, source_system: "helpdesk" };
    if (twin.refund_amount_inr) twin.refund_amount_inr = String(Math.round(Number(twin.refund_amount_inr) / 100)); // re-import landed in rupees
    dups.push(twin);
  }
}
const all = [...tickets, ...dups].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ticket_id.localeCompare(b.ticket_id));

const cols = Object.keys(tickets[0]);
fs.writeFileSync(path.join(ROOT, "data/tickets.synthetic.csv"), Papa.unparse(all, { columns: cols }), "utf8");
fs.writeFileSync(path.join(ROOT, "data/tickets.truth.csv"), Papa.unparse(truth), "utf8");

fs.mkdirSync(path.join(ROOT, "public/sample"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "data/tickets.synthetic.csv"), path.join(ROOT, "public/sample/tickets.synthetic.csv"));
fs.copyFileSync(path.join(ROOT, "data/tickets.truth.csv"), path.join(ROOT, "public/sample/tickets.truth.csv"));

const refunds = tickets.filter((t) => t.refund_amount_inr);
const rawSum = all.reduce((s, t) => s + (Number(t.refund_amount_inr) || 0), 0);
console.log(`tickets: ${tickets.length} unique, ${all.length} rows incl. ${dups.length} re-imports`);
console.log(`refund tickets: ${refunds.length} (${((refunds.length / tickets.length) * 100).toFixed(1)}%)`);
console.log(`naive sum of refund column (what a careless export shows): Rs ${(rawSum / 1e7).toFixed(2)} crore`);
