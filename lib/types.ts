export const REASON_CODES = [
  "GW-OTHER",
  "DOA-REPL",
  "LOST-TRANSIT",
  "DUP-PAYMENT",
  "CANCEL",
  "PRICE-ADJ",
  "RETURN-QC-OK",
  "WTY-BUYBACK",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
/** UNCLEAR = the notes genuinely don't say; we refuse to guess. */
export type CorrectedCode = ReasonCode | "UNCLEAR";

export const REASON_LABEL: Record<CorrectedCode, string> = {
  "GW-OTHER": "Goodwill / Other",
  "DOA-REPL": "Dead on arrival (refund chosen)",
  "LOST-TRANSIT": "Lost or undelivered",
  "DUP-PAYMENT": "Duplicate or failed payment",
  CANCEL: "Cancelled before dispatch",
  "PRICE-ADJ": "Price or coupon adjustment",
  "RETURN-QC-OK": "Return passed QC",
  "WTY-BUYBACK": "Warranty buy-back",
  UNCLEAR: "Unclear from notes",
};

export type RawTicket = Record<string, string>;

export interface Agent {
  agent_id: string;
  name: string;
  site: string;
  team: string;
  shift: string;
  tier: string;
}
export interface Product {
  sku: string;
  product_name: string;
  family: string;
  unit_cost_inr: number;
  retail_price_inr: number;
}
export interface Order {
  order_id: string;
  customer_id: string;
  sku: string;
  order_date: string;
  channel: string;
  qty: number;
  order_value_inr: number;
  lot_code: string;
}

export type ClassSource = "rules" | "llm" | "rules-fallback" | "manual";

export interface Refund {
  ticket_id: string;
  month: string; // YYYY-MM of creation
  quarter: string; // 2025-Q3
  created_at: string;
  agent_id: string;
  team: string;
  source_system: string;
  amount: number; // rupees, after unit correction
  rawAmount: number; // as exported
  scaled: boolean; // legacy unit correction applied
  reportedCode: string; // what the agent picked ("" if blank)
  code: CorrectedCode; // corrected reason
  codeSource: ClassSource;
  confidence: number; // 0..1
  evidence: string;
  message: string;
  note: string;
  sku: string;
  orderId: string;
  orderValue: number | null;
  lot: string;
  replacementFlag: boolean;
  replacementInNote: boolean;
  doublePayout: boolean;
  replacementCost: number; // unit cost + 340 when doublePayout
  capBreach: boolean; // goodwill > 500
  csat: number | null;
}

export type IssueKind = "info" | "warn" | "fix";
export interface Issue {
  kind: IssueKind;
  title: string;
  detail: string;
  count?: number;
  rupees?: number;
}

export interface CleanResult {
  totalRows: number;
  uniqueTickets: number;
  duplicatesRemoved: number;
  conflictingDuplicates: number;
  refunds: Refund[];
  allTickets: { month: string; team: string; agent_id: string; hasRefund: boolean; csat: number | null; created: string }[];
  unit: { factor: number; method: "inferred" | "default" | "manual"; sampleSize: number; note: string };
  rawSum: number; // naive sum of the refund column
  dupSum: number; // amount that came from duplicate rows (raw, as exported)
  skippedSum: number; // amount on rows too broken to place in a month (raw)
  unitAdjustment: number; // rupees removed by unit correction
  cleanSum: number;
  issues: Issue[];
  rowsSkipped: { row: number; reason: string }[];
  missingColumns: string[];
  dateRange: [string, string] | null;
}
