import Papa from "papaparse";
import type { RawTicket } from "./types";

/** Columns the README promises. The tool needs the first group to do anything useful. */
export const REQUIRED_COLUMNS = ["ticket_id", "created_at", "refund_amount_inr", "agent_id"] as const;
export const EXPECTED_COLUMNS = [
  "ticket_id", "created_at", "first_response_at", "resolved_at", "status", "channel", "customer_id",
  "order_id", "product_sku", "category", "priority", "assigned_team", "agent_id", "transfers",
  "csat_score", "refund_amount_inr", "refund_reason_code", "replacement_issued", "customer_message",
  "agent_notes", "source_system",
] as const;

export interface ParsedCsv {
  rows: RawTicket[];
  columns: string[];
  missingRequired: string[];
  missingOptional: string[];
  parseErrors: string[];
}

const norm = (h: string) =>
  h.replace(/^﻿/, "").trim().toLowerCase().replace(/[\s\-]+/g, "_");

/** Accepts common header spellings so a slightly different export still loads. */
const ALIASES: Record<string, string> = {
  ticket: "ticket_id", id: "ticket_id", ticketid: "ticket_id",
  created: "created_at", createdat: "created_at",
  refund_amount: "refund_amount_inr", refund: "refund_amount_inr", refund_inr: "refund_amount_inr",
  reason_code: "refund_reason_code", refund_reason: "refund_reason_code",
  agent: "agent_id", agentid: "agent_id",
  notes: "agent_notes", agent_note: "agent_notes",
  message: "customer_message", customer_msg: "customer_message",
  sku: "product_sku", replacement: "replacement_issued",
  source: "source_system", csat: "csat_score",
};

export function parseTicketsCsv(text: string): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => {
      const n = norm(h);
      return ALIASES[n] ?? n;
    },
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  const columns = res.meta.fields ?? [];
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  const missingOptional = EXPECTED_COLUMNS.filter((c) => !columns.includes(c) && !(REQUIRED_COLUMNS as readonly string[]).includes(c));
  const parseErrors = res.errors
    .filter((e) => e.code !== "TooFewFields" && e.code !== "TooManyFields")
    .slice(0, 5)
    .map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  return { rows: res.data as RawTicket[], columns, missingRequired, missingOptional, parseErrors };
}

/**
 * Money parser. Handles "1,499.00", "₹1499", "Rs. 1,499", "(500)" and "-500".
 * Returns null for blank / NA / non-numeric so callers can tell "no refund" from "refund of 0".
 */
export function parseAmount(v: string | undefined): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || /^(na|n\/a|null|none|-|--)$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/₹|rs\.?|inr/gi, "").replace(/\s/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/** Returns "YYYY-MM-DD HH:MM:SS" or null. Accepts ISO-ish and DD/MM/YYYY. */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return valid(m[1], m[2], m[3], m[4], m[5], m[6]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return valid(m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0"), m[4], m[5], m[6]);
  return null;
}
function valid(y: string, mo: string, d: string, h = "00", mi = "00", s = "00") {
  const mm = Number(mo), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${mo}-${d} ${h.padStart(2, "0")}:${mi}:${s}`;
}

export function quarterOf(iso: string): string {
  const y = iso.slice(0, 4);
  const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  return `${y}-Q${q}`;
}
export function quarterLabel(q: string): string {
  const [y, qq] = q.split("-Q");
  const r = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][Number(qq) - 1];
  return `${r} ${y}`;
}
