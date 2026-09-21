"use client";
import { useMemo, useState } from "react";
import { byReason, doublePayouts, reclassification, type View } from "@/lib/analyze";
import { buildWorkbook } from "@/lib/export";
import { inr, inrShort, monthLabel, num, pct } from "@/lib/format";
import { clearLlmCache, needsLlm, type LlmSettings, type Progress } from "@/lib/classify";
import type { Reference } from "@/lib/reference";
import type { CleanResult, Refund } from "@/lib/types";
import { REASON_LABEL } from "@/lib/types";
import { Chart } from "./Chart";
import type { DrawerSpec } from "./Drawer";
import { CODE_COLOR, Explain, Section, download, toCsv } from "./ui";

interface Props {
  clean: CleanResult; refunds: Refund[]; ref_: Reference; source: { label: string; synthetic: boolean } | null; helpdeskQ: number;
  ai: { serverKey: boolean; needsAccessCode: boolean; model: string } | null;
  settings: LlmSettings; saveSettings: (s: LlmSettings) => void;
  progress: Progress | null; startAi: () => void; stopAi: () => void;
  openDrawer: (d: DrawerSpec) => void; flash: (m: string) => void;
}

export function Summary({ clean, refunds, ref_, source, helpdeskQ, ai, settings, saveSettings, progress, startAi, stopAi, openDrawer, flash }: Props) {
  const [view, setView] = useState<View>("corrected");
  const [building, setBuilding] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const d = useMemo(() => byReason(refunds, view), [refunds, view]);
  const dp = useMemo(() => doublePayouts(refunds, ref_), [refunds, ref_]);
  const rc = useMemo(() => reclassification(refunds), [refunds]);
  const pending = refunds.filter(needsLlm).length;
  const unclear = refunds.filter((r) => r.code === "UNCLEAR").length;
  const running = progress?.state === "running" || progress?.state === "paused-rate";
  const max = Math.max(...d.months.flatMap((m) => d.codes.map((c) => d.matrix[m][c]?.amount ?? 0)), 1);
  const grand = d.codes.reduce((s, c) => s + d.totals[c].amount, 0);

  // The single number to move: refund + replacement on the same order.
  const share = dp.recentShare;
  const target = 0.01;
  const saving = share > target ? dp.perQuarterRunRate * (1 - target / share) : 0;

  const pick = (m: string | null, c: string | null) => {
    const list = refunds.filter((r) => (m == null || r.month === m) && (c == null || (view === "corrected" ? r.code : r.reportedCode || "(blank)") === c));
    openDrawer({ title: `${c ?? "All reasons"}${m ? ` · ${monthLabel(m)}` : ""}`, sub: view === "corrected" ? "Corrected reason." : "As coded by agents.", ids: list.map((r) => r.ticket_id) });
  };

  const exportXlsx = async () => {
    setBuilding(true);
    try {
      const blob = await buildWorkbook({ clean, refunds, ref: ref_, helpdeskQuarterly: helpdeskQ, dataLabel: source?.label ?? "tickets.csv" });
      download(blob, `refund-summary${source?.synthetic ? "-SYNTHETIC" : ""}.xlsx`);
      flash("Excel workbook downloaded (7 sheets).");
    } catch (e) { flash("Could not build the workbook: " + (e instanceof Error ? e.message : "unknown error")); }
    setBuilding(false);
  };
  const exportCsv = () => {
    const head = ["month", ...d.codes, "total"];
    const rows = d.months.map((m) => [m, ...d.codes.map((c) => Math.round(d.matrix[m][c]?.amount ?? 0)), Math.round(d.codes.reduce((s, c) => s + (d.matrix[m][c]?.amount ?? 0), 0))]);
    download(new Blob([toCsv([head, ...rows])], { type: "text/csv" }), `refunds-by-reason-${view}.csv`);
  };

  return (
    <>
      <Section id="reasons" no="03" title="Where the money went, month by month" sub="The core of Arjun's ask: refunds by reason code, corrected from what agents actually wrote.">
        <div className="number">
          <div>
            <div className="eyebrow">The number to move</div>
            <div className="bignum">{dp.count ? pct(share, 1) : "0%"}</div>
            <h3>of recent refunds also sent the customer a replacement</h3>
            <p style={{ marginBottom: 0 }}>
              Policy says never both. {dp.count ? <>Last six months. Across the whole file ({pct(dp.shareOfRefunds, 1)}) that is <b>{num(dp.count)} customers</b> and <b>{inrShort(dp.total)}</b> (refund plus replacement cost). At the recent pace it costs about <b>{inrShort(dp.perQuarterRunRate)} a quarter</b>.</> : "None found in this file."}
            </p>
          </div>
          <div>
            <div className="eyebrow">The goal</div>
            <h3 style={{ marginTop: 0 }}>Under 1% by next quarter</h3>
            <dl className="kv">
              <dt>Today (last 6 months)</dt><dd className="num">{inrShort(dp.perQuarterRunRate)} / qtr</dd>
              <dt>At under 1%</dt><dd className="num">{inrShort(dp.perQuarterRunRate - saving)} / qtr</dd>
              <dt><b>Recovered</b></dt><dd className="num"><b>{inrShort(saving)} / qtr</b></dd>
              <dt>Found only in notes (flag not ticked)</dt><dd className="num">{num(dp.flaggedByNoteOnly)}</dd>
            </dl>
            <p className="mute" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Replacement priced at product unit cost + ₹340, no refurbishment recovery (policy §5).</p>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "start" }}>
            <div style={{ maxWidth: "60ch" }}>
              <h3>Reason codes, corrected by reading the notes</h3>
              <p className="sub" style={{ marginBottom: 6 }}>
                Agents coded <b>{pct(rc.gwShareReported)}</b> of refunds as “Goodwill / Other”, the first option in the dropdown. Reading their own closing notes, only <b>{num(rc.trulyGoodwill.count)}</b> of the {num(rc.gwReportedCount)} are goodwill. The other <b>{inrShort(rc.movedOutAmount)}</b> belongs under real reasons.
              </p>
              <p className="sub" style={{ marginBottom: 0 }}>The agent&apos;s code matches the notes on <b>{pct(rc.agreementRate)}</b> of refunds.</p>
            </div>
            <div style={{ minWidth: 260, display: "grid", gap: 8 }}>
              <AiBar ai={ai} settings={settings} saveSettings={saveSettings} progress={progress} pending={pending} unclear={unclear}
                startAi={startAi} stopAi={stopAi} running={running} showKey={showKey} setShowKey={setShowKey} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="controls" style={{ justifyContent: "space-between" }}>
            <div className="seg" role="group" aria-label="Which reason codes">
              <button aria-pressed={view === "corrected"} onClick={() => setView("corrected")}>Corrected</button>
              <button aria-pressed={view === "reported"} onClick={() => setView("reported")}>As agents coded</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost small" onClick={exportCsv}>Download this table (CSV)</button>
              <button className="btn accent small" onClick={exportXlsx} disabled={building}>{building ? "Building…" : "Download board-pack workbook (Excel)"}</button>
              <button className="btn ghost small" onClick={() => window.print()}>Print</button>
            </div>
          </div>
          <Chart months={d.months} codes={d.codes} matrix={d.matrix} onPick={pick} />
        </div>

        <div className="tablewrap" style={{ marginTop: 16 }}>
          <table aria-label="Monthly refunds by reason code">
            <thead>
              <tr>
                <th>Month</th>
                {d.codes.map((c) => <th key={c} className="num" title={(REASON_LABEL as Record<string, string>)[c] ?? c}><span style={{ display: "inline-block", width: 8, height: 8, background: CODE_COLOR[c] ?? "#999", marginRight: 5 }} />{c}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.months.map((m) => {
                const tot = d.codes.reduce((s, c) => s + (d.matrix[m][c]?.amount ?? 0), 0);
                return (
                  <tr key={m}>
                    <td><button className="link" onClick={() => pick(m, null)}>{monthLabel(m)}</button></td>
                    {d.codes.map((c) => {
                      const cell = d.matrix[m][c];
                      const v = cell?.amount ?? 0;
                      return <td key={c} className="num heat" style={{ ["--h" as string]: v ? Math.min(0.32, (v / max) * 0.4) : 0 }}>{v ? <button className="cellbtn" onClick={() => pick(m, c)} title={`${cell.count} refunds`}>{inr(v)}</button> : <span className="mute">·</span>}</td>;
                    })}
                    <td className="num"><b>{inr(tot)}</b></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {d.codes.map((c) => <td key={c} className="num">{inr(d.totals[c].amount)}</td>)}
                <td className="num">{inr(grand)}</td>
              </tr>
              <tr>
                <td className="mute">Refunds</td>
                {d.codes.map((c) => <td key={c} className="num mute" style={{ fontWeight: 400 }}>{num(d.totals[c].count)}</td>)}
                <td className="num mute" style={{ fontWeight: 400 }}>{num(refunds.length)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="sub" style={{ marginTop: 8 }}>Click any figure to see the tickets behind it. Grand total {inr(grand)} = cleaned refunds from the reconciliation {grand === Math.round(clean.cleanSum) ? "✓" : `(differs by ${inr(grand - clean.cleanSum)})`}.</p>
        <Explain>
          <p>Each refund carries the code the agent picked, but the first dropdown option is “Goodwill / Other”, so it is over-used. We read the agent&apos;s closing note (and, if that is vague, the customer&apos;s opening message) to work out the real reason. A keyword pass settles the clear cases at once. The AI reads only what the keywords could not settle. If neither can tell, the refund is shown as <span className="chip">UNCLEAR</span> and never guessed.</p>
        </Explain>
      </Section>
    </>
  );
}

function AiBar({ ai, settings, saveSettings, progress, pending, unclear, startAi, stopAi, running, showKey, setShowKey }: {
  ai: Props["ai"]; settings: LlmSettings; saveSettings: (s: LlmSettings) => void; progress: Progress | null; pending: number; unclear: number;
  startAi: () => void; stopAi: () => void; running: boolean; showKey: boolean; setShowKey: (b: boolean) => void;
}) {
  const canCall = Boolean(ai?.serverKey || settings.groqKey);
  const p = progress;
  const pctDone = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div style={{ border: "1.5px solid var(--ink)", borderRadius: 3, padding: 12, background: "var(--paper)" }}>
      <div className="eyebrow">AI reading</div>
      {pending === 0 && !running ? (
        <p style={{ margin: 0 }}><span className="chip ok">all clear</span> {unclear ? `${num(unclear)} refunds have notes that do not say why and stay UNCLEAR.` : "Every refund has a reason."}</p>
      ) : (
        <>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}><b>{num(pending)}</b> refunds have vague notes. {canCall ? "The AI can read them." : "Add a free Groq key to let the AI read them; until then the keyword guess is used."}</p>
          {running && p && (
            <div role="status" aria-live="polite" style={{ marginBottom: 8 }}>
              <div className="meter"><i style={{ width: `${pctDone}%` }} /></div>
              <div className="mute" style={{ fontSize: 12.5, marginTop: 4 }}>
                {p.message ?? `${num(p.done)} of ${num(p.total)} read${p.cached ? ` (${num(p.cached)} remembered)` : ""}${p.etaSec ? ` · about ${Math.max(1, Math.round(p.etaSec / 60))} min left` : ""}`}
              </div>
            </div>
          )}
          {p?.state === "no-key" && <div className="banner bad" role="alert" style={{ margin: "0 0 8px" }}>{p.message ?? "No key."}</div>}
          {p?.state === "done" && <div className="banner good" style={{ margin: "0 0 8px" }}>Done. {num(p.calls)} calls, {num(p.tokens)} tokens{p.message ? ` · ${p.message}` : ""}.</div>}
          {p?.state === "stopped" && <div className="mute" style={{ marginBottom: 8, fontSize: 13 }}>Stopped. Progress is saved; press again to continue.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!running
              ? <button className="btn small accent" onClick={startAi} disabled={!canCall || pending === 0}>Read {num(pending)} with AI</button>
              : <button className="btn small ghost" onClick={stopAi}>Stop</button>}
            <button className="btn small ghost" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Key & settings"}</button>
          </div>
        </>
      )}
      {showKey && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label className="f">Your Groq API key (kept in this tab only)
            <input type="password" autoComplete="off" placeholder={ai?.serverKey ? "Server already has a key. Optional." : "gsk_…"} value={settings.groqKey ?? ""} onChange={(e) => saveSettings({ ...settings, groqKey: e.target.value.trim() || undefined })} />
          </label>
          {ai?.needsAccessCode && (
            <label className="f">Access code
              <input type="password" autoComplete="off" value={settings.accessCode ?? ""} onChange={(e) => saveSettings({ ...settings, accessCode: e.target.value || undefined })} />
            </label>
          )}
          <span className="mute" style={{ fontSize: 12.5 }}>Model: {ai?.model || "—"}. Free tier: 30 requests/min, 8,000 tokens/min. Only closing notes and customer messages of unclear refunds are sent.</span>
          <button className="link" style={{ justifySelf: "start", fontSize: 13 }} onClick={() => { clearLlmCache(); }}>Forget remembered AI answers</button>
        </div>
      )}
    </div>
  );
}
