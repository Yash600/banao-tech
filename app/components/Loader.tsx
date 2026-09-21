"use client";
import { useRef, useState } from "react";

interface Props {
  busy: string; error: string; refErr: string; refReady: boolean;
  source: { label: string; synthetic: boolean } | null;
  onFile: (f: File) => void; onSample: () => void; onClear: () => void;
}

export function Loader({ busy, error, refErr, refReady, source, onFile, onSample, onClear }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const disabled = Boolean(busy) || !refReady;

  return (
    <section id="load" className="hero" aria-labelledby="h-load">
      {!source && (
        <>
          <h1 id="h-load">Where did the refund money <em>go</em>?</h1>
          <p className="lede">
            Drop in the helpdesk export. In a few seconds you get monthly refunds by reason code and by agent, with a total that ties back to the file, ready to paste into the board pack.
          </p>
        </>
      )}
      {source && (
        <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Loaded</div>
            <b className="mono">{source.label}</b> {source.synthetic && <span className="chip warn">synthetic</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn ghost small" onClick={() => input.current?.click()} disabled={disabled}>Load another file</button>
            <button className="btn ghost small" onClick={onClear}>Clear</button>
          </div>
          <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </div>
      )}

      {!source && (
        <div
          className={`drop${over ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onFile(f); }}
        >
          <h3>Drop tickets.csv here</h3>
          <p className="mute" style={{ margin: 0 }}>Nothing leaves your computer at this step. The file is read in your browser.</p>
          <div className="row">
            <button className="btn accent" onClick={() => input.current?.click()} disabled={disabled}>Choose the CSV</button>
            <span className="mute">or</span>
            <button className="btn ghost" onClick={onSample} disabled={disabled}>Try the synthetic sample</button>
          </div>
          <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          {busy && (
            <div role="status" style={{ width: "100%" }}>
              <div className="meter" style={{ marginTop: 6 }}><i style={{ width: "60%", animation: "sk 1s infinite linear" }} /></div>
              <span className="mute">{busy}</span>
            </div>
          )}
          {!refReady && !refErr && <span className="mute">Loading the order and agent reference data…</span>}
        </div>
      )}

      {refErr && <div className="banner bad" role="alert" style={{ marginTop: 16 }}><b>Reference data failed to load.</b> {refErr}. Refresh the page; if it persists, the files in <span className="mono">public/ref</span> are missing.</div>}
      {error && <div className="banner bad" role="alert" style={{ marginTop: 16 }}><b>Could not use that file.</b> {error}</div>}
      {busy && source && <div role="status" className="mute" style={{ marginTop: 10 }}>{busy}</div>}
    </section>
  );
}
