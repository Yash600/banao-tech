"use client";
import type { ReactNode } from "react";
import type { CorrectedCode } from "@/lib/types";

export const CODE_COLOR: Record<string, string> = {
  "GW-OTHER": "#b83a20",
  "DOA-REPL": "#1f4e5f",
  "LOST-TRANSIT": "#8a6d3b",
  "DUP-PAYMENT": "#6b5a8c",
  CANCEL: "#4f7a5a",
  "PRICE-ADJ": "#d0a230",
  "RETURN-QC-OK": "#38495a",
  "WTY-BUYBACK": "#a0506b",
  UNCLEAR: "#a19c90",
  "(blank)": "#c9c2b0",
};

export function Section({ id, no, title, sub, children }: { id: string; no: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="sec" aria-labelledby={`h-${id}`}>
      <div className="sec-head">
        <span className="no">{no}</span>
        <h2 id={`h-${id}`}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export function Explain({ children, label = "How this is worked out" }: { children: ReactNode; label?: string }) {
  return <details className="expl"><summary>{label}</summary><div>{children}</div></details>;
}

export function CodeChip({ code }: { code: CorrectedCode | string }) {
  const c = CODE_COLOR[code] ?? "#999";
  return <span className="chip" style={{ borderColor: c, color: c }}>{code}</span>;
}

export function SortHead({ label, k, sort, setSort, num }: { label: string; k: string; sort: { k: string; dir: 1 | -1 }; setSort: (s: { k: string; dir: 1 | -1 }) => void; num?: boolean }) {
  const on = sort.k === k;
  return (
    <th className={num ? "num" : ""} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort({ k, dir: on ? ((sort.dir * -1) as 1 | -1) : -1 })}>{label}<span aria-hidden>{on ? (sort.dir === 1 ? "▲" : "▼") : ""}</span></button>
    </th>
  );
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCsv(rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection from ticket text
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
