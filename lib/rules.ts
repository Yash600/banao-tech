import type { ReasonCode, CorrectedCode } from "./types";

/**
 * Rules pass. Fast, free and explainable: every verdict carries the phrase that triggered it.
 * Anything the rules cannot settle goes to the LLM (or is left UNCLEAR if no LLM is reachable).
 * The agent's closing note counts double: they wrote it at closure, the customer message is only the opening ask.
 *
 * Written against Vireo's real agent notes, which are full of typos ("rnfd", "refudn"), shorthand
 * ("pkp", "rplc", "cx", "crr"), numbered lists and SOP codes, so text is normalised before matching.
 */

// ---------- normalisation ----------
const ALIAS: Record<string, string> = {
  rfnd: "refund", rnfd: "refund", rfdn: "refund", rfund: "refund", rfd: "refund", rfnds: "refunds",
  rplc: "replacement", rplcmnt: "replacement", rplcmt: "replacement", replcmnt: "replacement", rpl: "replacement",
  pkp: "pickup", pkup: "pickup", ord: "order", cx: "customer", cust: "customer", crr: "courier", cr: "courier",
  dlvry: "delivery", dlvrd: "delivered", conf: "confirmed", chk: "checked", xfer: "transferred", rslvd: "resolved",
  wty: "warranty", pg: "paymentgateway", txn: "transaction", rcvd: "received", recd: "received", esc: "escalated",
  adv: "advised", tl: "teamlead", doa: "doa", rto: "rto",
};
// correct spellings we fuzzy-match typos against
const VOCAB = [
  "refund", "refunded", "replacement", "duplicate", "payment", "cancelled", "cancellation", "dispatched", "delivery", "delivered",
  "undelivered", "pickup", "transit", "damaged", "goodwill", "warranty", "shipment", "courier", "gateway", "coupon", "discount",
  "reverse", "credited", "deducted", "debited", "received", "confirmed", "processed", "initiated", "approved", "checked", "customer",
  "transferred", "dispatch", "shipped", "cancel", "charged", "double", "return", "returned", "pending", "arrived", "faulty", "promo",
  "gesture", "escalated", "reshipped", "declined", "rejected", "opted", "preferred", "buyback", "service", "centre", "photos",
];
const VOCAB_SET = new Set(VOCAB);

function editDist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const fuzzyCache = new Map<string, string>();
function fixWord(w: string): string {
  if (ALIAS[w]) return ALIAS[w];
  if (w.length < 5 || VOCAB_SET.has(w) || /\d/.test(w)) return w;
  const hit = fuzzyCache.get(w);
  if (hit !== undefined) return hit;
  const max = w.length >= 8 ? 2 : 1;
  let best = w;
  for (const v of VOCAB) {
    if (editDist(w, v, max) <= max) { best = v; break; }
  }
  fuzzyCache.set(w, best);
  return best;
}
export function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\(sop [\d.]+\)/g, " ")
    .replace(/[~]\s*\w+|\/\/\s*\w+|--?\s*[a-z]{2,4}\s*$/g, " ")
    .replace(/[^a-z0-9%+&/.,;:|>\-()' ]+/g, " ")
    .split(/\s+/)
    .map((w) => {
      const m = w.match(/^([a-z']+)([.,;:|)]*)$/);
      return m ? fixWord(m[1]) + m[2] : w;
    })
    .join(" ");
}

// ---------- reason patterns (on normalised text) ----------
const P: Record<ReasonCode, RegExp[]> = {
  "DOA-REPL": [/dead on arrival/, /\bdoa\b/, /not (powering|switching) on|won'?t (switch|power|turn) on|doesn'?t power up|arrived faulty|dead out of (the )?box/],
  "LOST-TRANSIT": [
    /lost in transit|shipment lost|parcel lost|package lost/, /undelivered|not delivered|never (arrived|got it|received)|haven'?t received|not received|shipment not received/,
    /\brto (confirmed|conf)|returned to origin/, /transit damage|damaged in transit/, /delivery delayed|(?<!pickup )\bawb\b|courier (partner|confirmed)|tracking (stuck|not updating|hasn'?t)/,
  ],
  "DUP-PAYMENT": [
    /duplicate (payment|charge|transaction|refunded)|double (charge|charged|payment|debit|deducted)|charged twice|paid twice|deducted (two|twice)/,
    /amount deducted|payment debited|money debited|debited but|no order id|payment (went through|failed)|failed payment/, /\butrs?\b|\btransaction\b|paymentgateway (dashboard|for)/,
  ],
  CANCEL: [/cancel(l?ed|lation)? before dispatch|before dispatch/, /\bcancel(l?ed|lation|ling)?\b/, /ordered by mistake|not yet shipped|hasn'?t shipped/],
  "PRICE-ADJ": [/coupon|promo( code)?|discount|price (adjust|drop|mismatch|difference)|sale price|store credit/],
  "RETURN-QC-OK": [
    /reverse pickup|pickup (not done|missed|pending|scheduled)|nobody came for the pickup|pickup (was )?not/, /qc (status|passed|ok|cleared)|passed qc/,
    /return (accepted|received|picked)|item received back|picked up the item/, /refund (not credited|pending|delay|not received|status)|\barn\b|amount is nowhere|money hasn'?t come/,
  ],
  "WTY-BUYBACK": [/buy[- ]?back/, /warranty claim|rma status|service centre|repeat(ed)? (in-warranty )?(failure|fault)|repaired twice/],
  "GW-OTHER": [/goodwill|good will|one-time gesture/, /compensat(e|ed|ion)/, /apologi[sz]ed|poor experience|upset about wait/],
};
const STRONG: Record<ReasonCode, RegExp> = {
  "DOA-REPL": /dead on arrival|\bdoa\b/,
  "LOST-TRANSIT": /lost in transit|undelivered|rto|transit damage|damaged in transit|not delivered/,
  "DUP-PAYMENT": /duplicate|double|charged twice|failed payment|utr|amount deducted|payment debited/,
  CANCEL: /before dispatch|cancel/,
  "PRICE-ADJ": /coupon|promo|discount/,
  "RETURN-QC-OK": /qc|reverse pickup|pickup (not done|missed|pending)|arn/,
  "WTY-BUYBACK": /buy[- ]?back|warranty claim|rma status/,
  "GW-OTHER": /goodwill/,
};

export interface RuleVerdict {
  code: CorrectedCode;
  confidence: number; // 0..1
  evidence: string;
  /** true when the verdict rests on the agent's own closing note (not just the customer's opening message) */
  fromNote: boolean;
  settled: boolean; // safe to skip the LLM
}

export function classifyByRules(message: string, note: string, hint?: string): RuleVerdict {
  const scores = new Map<ReasonCode, { s: number; hit: string; noteHit: boolean }>();
  const bump = (code: ReasonCode, w: number, hit: string, inNote: boolean) => {
    const cur = scores.get(code) ?? { s: 0, hit: "", noteHit: false };
    cur.s += w;
    if (!cur.hit || w >= 2) cur.hit = hit;
    if (inNote) cur.noteHit = true;
    scores.set(code, cur);
  };
  const scan = (raw: string, weight: number, inNote: boolean) => {
    const text = normalize(raw);
    if (!text) return;
    for (const code of Object.keys(P) as ReasonCode[]) {
      for (const re of P[code]) {
        const m = text.match(re);
        if (m) bump(code, weight + (STRONG[code].test(m[0]) ? 1 : 0), m[0], inNote);
      }
    }
  };
  scan(note, 2, true);
  scan(message, 1, false);

  const ranked = [...scores.entries()].sort((a, b) => b[1].s - a[1].s);
  if (!ranked.length) return { code: "UNCLEAR", confidence: 0, evidence: "no reason keywords in note or message", fromNote: false, settled: false };
  let [top, second] = ranked;
  // Tie-break: when the text fits two reasons and the agent deliberately picked a *specific* code (not the
  // dropdown default) that is one of the near-top candidates, keep the agent's code.
  let agentTie = false;
  if (hint && hint !== "GW-OTHER" && top[0] !== hint) {
    const h = ranked.find((r) => r[0] === hint);
    if (h && h[1].s >= top[1].s - 2) { second = top; top = h; agentTie = true; }
  }
  const margin = agentTie ? 0 : top[1].s - (second?.[1].s ?? 0);
  const fromNote = top[1].noteHit;
  const settled = fromNote && top[1].s >= 3 && margin >= 2;
  const confidence = Math.max(0.3, Math.min(0.95, 0.4 + top[1].s * 0.1 + margin * 0.08 + (fromNote ? 0.1 : 0)));
  return { code: top[0], confidence: settled ? Math.max(confidence, 0.85) : Math.min(confidence, 0.7), evidence: agentTie ? `“${top[1].hit}”, fits the agent's own code` : `“${top[1].hit}”${fromNote ? " in agent note" : " in customer message"}`, fromNote, settled };
}

// ---------- refund + replacement detection ----------
/**
 * Detects "the customer also got a new unit" in the agent note. Works segment by segment so that
 * "replacement offered earlier, customer opted for refund" and "replacement not applicable (out of stock)"
 * (which mention a replacement but mean the opposite) are not counted.
 */
const NEG = /declin|reject|not applicable|out of stock|opted for|preferred|refund only|explained policy|not possible|cannot|unable|not eligible|as per policy|was offered|offered (a )?replacement|asked for (a )?replacement|request(ed)? (for )?(a )?replacement|replacement request|denied|not approved|no replacement|does not want|don'?t want|over replacement|instead of|refused/;
const POS = [
  /both (a )?refund (and|&|\+) (a )?replacement|refund (and|&|\+) replacement both|refund \+ replacement|replacement \+ refund|refund and (a )?replacement (given|issued|dispatched)/,
  /(also|as well|too)\b[^.|;]*\b(raised|sent|sending|dispatched|shipped|issued|given|going out)?[^.|;]*\b(new|fresh|replacement) (unit|set|pair|piece|one|device|product)/,
  /(new|fresh) (unit|set|pair|piece|one|device)[^.|;]*(shipped|sent|dispatched|going out|also|as one-time|from)/,
  /(sent|sending|dispatched|shipped|issued|raised|gave|given) (a |the )?(new|fresh) (unit|set|pair|piece|one|device)/,
  /replacement( unit)? (dispatched|shipped|sent|raised|issued|approved|going out|given)/,
  /(dispatched|shipped|sent|raised|issued) (a |the )?replacement/,
  /raised rma for (a )?(new|replacement)|dispatched a new one under rma|new unit also|replacement unit also/,
  /refunded[^.|;]*&[^.|;]*also raised[^.|;]*replacement|released the money as well/,
];
export function replacementMentioned(note: string): boolean {
  if (!note) return false;
  const text = normalize(note);
  const segments = text.split(/[.|;]|--|->|\n|\d\.\s/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    if (NEG.test(seg)) continue;
    if (POS.some((re) => re.test(seg))) return true;
  }
  // some phrases straddle segments ("refund + rplc"); check the whole text once with negation guard on the whole note
  return !NEG.test(text) && POS.some((re) => re.test(text));
}
