"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { parseTicketsCsv, type ParsedCsv } from "@/lib/csv";
import { loadReference, type Reference } from "@/lib/reference";
import { cleanTickets } from "@/lib/pipeline";
import { markCapBreaches } from "@/lib/analyze";
import { cachedVerdicts, runLlmPass, needsLlm, type LlmSettings, type Progress } from "@/lib/classify";
import type { CleanResult, CorrectedCode, Refund } from "@/lib/types";
import { Loader } from "./components/Loader";
import { Books } from "./components/Books";
import { Summary } from "./components/Summary";
import { Agents } from "./components/Agents";
import { Doubles } from "./components/Doubles";
import { Claims } from "./components/Claims";
import { Trust, type Truth } from "./components/Trust";
import { Drawer, type DrawerSpec } from "./components/Drawer";

export interface Override { code: CorrectedCode; evidence: string; source: "llm" | "manual" }

const SECTIONS = [
  ["load", "Load the export"],
  ["books", "Do the books balance?"],
  ["reasons", "By reason, by month"],
  ["agents", "By agent"],
  ["doubles", "Refund + replacement"],
  ["claims", "Testing the stories"],
  ["trust", "How far to trust this"],
] as const;

export default function Page() {
  const [ref, setRef] = useState<Reference | null>(null);
  const [refErr, setRefErr] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [source, setSource] = useState<{ label: string; synthetic: boolean } | null>(null);
  const [truth, setTruth] = useState<Record<string, Truth> | null>(null);
  const [factor, setFactor] = useState<number | null>(null);
  // human/AI edits are tied to the exact cleaned file they were made on, so loading another file starts fresh
  const [edits, setEdits] = useState<{ for: CleanResult | null; map: Map<string, Override> }>({ for: null, map: new Map() });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [helpdeskQ, setHelpdeskQ] = useState(1_100_000);
  const [drawer, setDrawer] = useState<DrawerSpec | null>(null);
  const [toast, setToast] = useState("");
  const [active, setActive] = useState("load");
  const [ai, setAi] = useState<{ serverKey: boolean; needsAccessCode: boolean; model: string } | null>(null);
  const [settings, setSettings] = useState<LlmSettings>({});
  const [progressState, setProgressState] = useState<{ for: CleanResult | null; p: Progress } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // reference data + AI availability, once
  useEffect(() => {
    loadReference().then(setRef).catch((e) => setRefErr(String(e.message || e)));
    fetch("/api/health").then((r) => r.json()).then(setAi).catch(() => setAi({ serverKey: false, needsAccessCode: false, model: "" }));
    try {
      const k = sessionStorage.getItem("vireo.key");
      const c = sessionStorage.getItem("vireo.access");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser, so it cannot seed initial state
      if (k || c) setSettings({ groqKey: k || undefined, accessCode: c || undefined });
    } catch { /* storage blocked */ }
  }, []);

  const saveSettings = (s: LlmSettings) => {
    setSettings(s);
    try {
      if (s.groqKey) sessionStorage.setItem("vireo.key", s.groqKey); else sessionStorage.removeItem("vireo.key");
      if (s.accessCode) sessionStorage.setItem("vireo.access", s.accessCode); else sessionStorage.removeItem("vireo.access");
    } catch { /* ignore */ }
  };

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3800); }, []);

  const clean = useMemo(() => (parsed && ref ? cleanTickets(parsed, ref, { unitFactor: factor }) : null), [parsed, ref, factor]);

  const progress = progressState && progressState.for === clean ? progressState.p : null;
  // anything already paid for on a previous run of the same file comes back instantly
  const cached = useMemo(() => (clean ? cachedVerdicts(clean.refunds) : new Map<string, Override>()), [clean]);
  const overrides = useMemo(() => {
    const m = new Map<string, Override>(cached);
    if (edits.for === clean) for (const [k, v] of edits.map) m.set(k, v);
    return m;
  }, [cached, edits, clean]);
  // a new file cancels any AI run still going for the old one
  useEffect(() => () => abortRef.current?.abort(), [clean]);

  const refunds: Refund[] = useMemo(() => {
    if (!clean) return [];
    const merged = clean.refunds.map((r) => {
      const o = overrides.get(r.ticket_id);
      return o ? { ...r, code: o.code, evidence: o.evidence, codeSource: o.source, confidence: o.source === "manual" ? 1 : 0.8 } : r;
    });
    return markCapBreaches(merged);
  }, [clean, overrides]);

  const readText = useCallback(async (text: string, label: string, synthetic: boolean) => {
    setError("");
    await new Promise((r) => setTimeout(r, 30)); // let the "reading" state paint before the heavy parse
    const p = parseTicketsCsv(text);
    if (!p.rows.length) { setBusy(""); setError("That file has a header but no rows, or is not a CSV. Nothing to summarise."); return; }
    if (p.missingRequired.length) {
      setBusy("");
      setError(`This file is missing the column${p.missingRequired.length > 1 ? "s" : ""} ${p.missingRequired.join(", ")}. The README's tickets.csv has ticket_id, created_at, agent_id and refund_amount_inr. Check you picked the right file.`);
      return;
    }
    setFactor(null);
    setParsed(p);
    setSource({ label, synthetic });
    setBusy("");
    setTimeout(() => document.getElementById("books")?.scrollIntoView({ behavior: "smooth" }), 120);
  }, []);

  const onFile = useCallback(async (file: File) => {
    setError("");
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setError(`“${file.name}” is not a CSV file. Export the tickets from the helpdesk as .csv and try again.`); return; }
    if (file.size === 0) { setError("That file is empty."); return; }
    setBusy(`Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
    setTruth(null);
    try { await readText(await file.text(), file.name, false); } catch (e) { setBusy(""); setError("Could not read that file: " + (e instanceof Error ? e.message : "unknown error")); }
  }, [readText]);

  const onSample = useCallback(async () => {
    setError(""); setBusy("Loading the synthetic sample…");
    try {
      const [t, tr] = await Promise.all([fetch("/sample/tickets.synthetic.csv").then((r) => { if (!r.ok) throw new Error("sample missing"); return r.text(); }), fetch("/sample/tickets.truth.csv").then((r) => r.text())]);
      const rows = Papa.parse<Truth>(tr, { header: true, skipEmptyLines: true }).data;
      setTruth(Object.fromEntries(rows.map((r) => [r.ticket_id, r])));
      await readText(t, "tickets.synthetic.csv", true);
    } catch (e) { setBusy(""); setError("Could not load the sample: " + (e instanceof Error ? e.message : "unknown")); }
  }, [readText]);

  const applyUpdates = useCallback((u: Map<string, { code: CorrectedCode; evidence: string; source: "llm" }>) => {
    setEdits((prev) => {
      const n = new Map(prev.for === clean ? prev.map : []);
      for (const [k, v] of u) if (n.get(k)?.source !== "manual") n.set(k, v); // never overwrite a human correction
      return { for: clean, map: n };
    });
  }, [clean]);

  const startAi = useCallback(async () => {
    if (!clean) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const targets = refunds.filter(needsLlm);
    await runLlmPass(targets, settings, (p) => setProgressState({ for: clean, p }), applyUpdates, ac.signal);
  }, [clean, refunds, settings, applyUpdates]);
  const stopAi = () => abortRef.current?.abort();

  const setManual = useCallback((id: string, code: CorrectedCode) => {
    setEdits((prev) => {
      const n = new Map(prev.for === clean ? prev.map : []);
      n.set(id, { code, evidence: "changed by reviewer", source: "manual" });
      return { for: clean, map: n };
    });
    flash(`${id} set to ${code}`);
  }, [flash, clean]);

  // which section is on screen (rail highlight)
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [clean]);

  const ready = Boolean(clean && ref);
  const nav = SECTIONS.map(([id, label], i) => ({ id, label, n: i + 1, disabled: i > 0 && !ready }));

  return (
    <div className="shell">
      <aside className="rail" aria-label="Sections">
        <div className="brand"><b>The Refund Ledger</b><span>Vireo Audio · Finance</span></div>
        <nav>
          <ol className="steps">
            {nav.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} aria-current={active === s.id} aria-disabled={s.disabled}><span className="n">{String(s.n).padStart(2, "0")}</span><span>{s.label}</span></a></li>
            ))}
          </ol>
        </nav>
        <div className="foot">
          {source && <p><b>{source.label}</b><br />{clean ? `${clean.uniqueTickets.toLocaleString("en-IN")} tickets · ${refunds.length.toLocaleString("en-IN")} refunds` : ""}</p>}
          <p>Everything is computed in your browser. Only the closing notes of unclear refunds go to the AI, and only when you press the button.</p>
        </div>
      </aside>

      <div className="topbar" aria-label="Sections">
        <b>Refund Ledger</b>
        {nav.filter((s) => !s.disabled).map((s) => <a key={s.id} href={`#${s.id}`} aria-current={active === s.id}>{s.label}</a>)}
      </div>

      <main className="main">
        <Loader
          busy={busy} error={error} refErr={refErr} refReady={Boolean(ref)} source={source}
          onFile={onFile} onSample={onSample}
          onClear={() => { setParsed(null); setSource(null); setTruth(null); setError(""); }}
        />

        {ready && clean && ref && (
          <>
            {source?.synthetic && (
              <div className="banner" role="note" style={{ marginTop: 28 }}>
                <b>This is the synthetic sample.</b> It was generated to the README&apos;s layout so the tool can be tried without client data. Every rupee below is fake. Load the real <span className="mono">tickets.csv</span> with “Load another file” to see Vireo&apos;s actual figures.
              </div>
            )}
            <Books clean={clean} factor={factor} setFactor={setFactor} helpdeskQ={helpdeskQ} setHelpdeskQ={setHelpdeskQ} refunds={refunds} />
            <Summary
              clean={clean} refunds={refunds} ref_={ref} source={source} helpdeskQ={helpdeskQ}
              ai={ai} settings={settings} saveSettings={saveSettings} progress={progress} startAi={startAi} stopAi={stopAi}
              openDrawer={setDrawer} flash={flash}
            />
            <Agents clean={clean} refunds={refunds} ref_={ref} openDrawer={setDrawer} />
            <Doubles refunds={refunds} ref_={ref} openDrawer={setDrawer} />
            <Claims clean={clean} refunds={refunds} ref_={ref} openDrawer={setDrawer} />
            <Trust refunds={refunds} truth={truth} openDrawer={setDrawer} setManual={setManual} flash={flash} progress={progress} />
          </>
        )}
      </main>

      {drawer && <Drawer spec={drawer} refunds={refunds} ref_={ref} onClose={() => setDrawer(null)} setManual={setManual} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
