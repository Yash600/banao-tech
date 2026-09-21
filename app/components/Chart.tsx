"use client";
import { useState } from "react";
import { inr, inrShort, monthLabel } from "@/lib/format";
import type { Cell } from "@/lib/analyze";
import { CODE_COLOR } from "./ui";

interface Props {
  months: string[]; codes: string[]; matrix: Record<string, Record<string, Cell>>;
  onPick: (month: string, code: string) => void;
}

const W = 900, H = 280, L = 58, R = 10, T = 12, B = 30;

/** Stacked monthly bars. Hand-drawn SVG so it prints cleanly and needs no chart library. */
export function Chart({ months, codes, matrix, onPick }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = months.map((m) => codes.reduce((s, c) => s + (matrix[m][c]?.amount ?? 0), 0));
  const rawMax = Math.max(...totals, 1);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const bw = (W - L - R) / months.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const present = codes.filter((c) => months.some((m) => (matrix[m][c]?.amount ?? 0) > 0));

  return (
    <div style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stacked bar chart of monthly refunds by reason. Highest month ${inrShort(rawMax)}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#d8cfbb" strokeDasharray={t === 0 ? "" : "2 3"} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{t === 0 ? "0" : inrShort(t).replace("₹", "").replace(" lakh", "L").replace(" crore", "Cr")}</text>
          </g>
        ))}
        {months.map((m, i) => {
          let acc = 0;
          const x = L + i * bw + bw * 0.14;
          const w = bw * 0.72;
          return (
            <g key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill={hover === i ? "rgba(26,25,22,0.05)" : "transparent"} />
              {codes.map((c) => {
                const v = matrix[m][c]?.amount ?? 0;
                if (v <= 0) return null;
                const y0 = y(acc + v), h = y(acc) - y(acc + v);
                acc += v;
                return <rect key={c} x={x} y={y0} width={w} height={Math.max(h, 0.5)} fill={CODE_COLOR[c] ?? "#999"} style={{ cursor: "pointer" }} onClick={() => onPick(m, c)}><title>{`${monthLabel(m)} · ${c} · ${inr(v)}`}</title></rect>;
              })}
              <text x={L + i * bw + bw / 2} y={H - 10} textAnchor="middle">{months.length > 12 ? monthLabel(m).slice(0, 3) + (m.endsWith("-01") || i === 0 ? " " + m.slice(2, 4) : "") : monthLabel(m)}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `min(calc(${((L + hover * bw) / W) * 100}% + 20px), calc(100% - 210px))`, top: 4 }}>
          <b>{monthLabel(months[hover])} · {inr(totals[hover])}</b>
          {present.filter((c) => (matrix[months[hover]][c]?.amount ?? 0) > 0).sort((a, b) => matrix[months[hover]][b].amount - matrix[months[hover]][a].amount).map((c) => (
            <div className="r" key={c}><span>{c}</span><span>{inr(matrix[months[hover]][c].amount)}</span></div>
          ))}
        </div>
      )}
      <div className="legend">{present.map((c) => <span key={c}><i style={{ background: CODE_COLOR[c] ?? "#999" }} />{c}</span>)}</div>
    </div>
  );
}

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
