import type { CorrectedCode, Refund } from "./types";

/**
 * Client-side driver for the LLM pass.
 * - Only tickets the rules could not settle are sent (typically a third or less).
 * - Batches of 40, two in flight, honouring Groq's 429 retry-after (free tier: 8K tokens/min).
 * - Every verdict is cached in the browser, so a second run of the same file makes zero calls.
 * - Failures never lose work: the rules verdict stays in place and the ticket is marked as such.
 */
const BATCH = 40;
const CONCURRENCY = 2;
const CACHE_KEY = "vireo.llm.v1";

export interface LlmSettings { groqKey?: string; accessCode?: string }
export interface Progress {
  total: number; done: number; cached: number; calls: number; tokens: number;
  state: "idle" | "running" | "paused-rate" | "done" | "stopped" | "no-key" | "error";
  message?: string;
  etaSec?: number;
}
type Verdict = { code: CorrectedCode; evidence: string };

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
/** Strip signature/SOP noise and cap length so each ticket costs fewer tokens (Groq free tier is 8K tokens/min). */
export function slim(text: string, max: number): string {
  return (text || "").replace(/\(sop [\d.]+\)/gi, " ").replace(/(~|\/\/|--)\s*\w+\s*$/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
const keyOf = (r: Refund) => r.ticket_id + ":" + hash(r.message + "|" + r.note);

function loadCache(): Record<string, Verdict> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c: Record<string, Verdict>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* storage full or blocked: fine, just no cache */ }
}
export function clearLlmCache() { try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } }

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
  });

export function needsLlm(r: Refund) { return r.codeSource === "rules-fallback"; }

/** Returns tickets that were upgraded so the caller can merge them into state as they arrive. */
export async function runLlmPass(
  refunds: Refund[],
  settings: LlmSettings,
  onProgress: (p: Progress) => void,
  onUpdate: (updates: Map<string, { code: CorrectedCode; evidence: string; source: "llm" }>) => void,
  signal: AbortSignal,
): Promise<Progress> {
  const cache = loadCache();
  const todo = refunds.filter(needsLlm);
  // ones the rules found nothing for come first: the biggest gain per call
  todo.sort((a, b) => a.confidence - b.confidence);
  const p: Progress = { total: todo.length, done: 0, cached: 0, calls: 0, tokens: 0, state: "running" };
  const emit = () => onProgress({ ...p });

  const fromCache = new Map<string, { code: CorrectedCode; evidence: string; source: "llm" }>();
  const pending: Refund[] = [];
  for (const r of todo) {
    const c = cache[keyOf(r)];
    if (c) { fromCache.set(r.ticket_id, { ...c, source: "llm" }); p.done++; p.cached++; } else pending.push(r);
  }
  if (fromCache.size) onUpdate(fromCache);
  emit();
  if (!pending.length) { p.state = "done"; emit(); return p; }

  const batches: Refund[][] = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));
  let next = 0;
  let fatal: Progress["state"] | null = null;
  const t0 = Date.now();

  const worker = async () => {
    while (!signal.aborted && !fatal) {
      const bi = next++;
      if (bi >= batches.length) return;
      const batch = batches[bi];
      let attempt = 0;
      while (!signal.aborted && !fatal) {
        attempt++;
        try {
          const res = await fetch("/api/classify", {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              ...(settings.groqKey ? { "x-groq-key": settings.groqKey } : {}),
              ...(settings.accessCode ? { "x-access-code": settings.accessCode } : {}),
            },
            body: JSON.stringify({ items: batch.map((r) => ({ id: r.ticket_id, message: slim(r.message, 170), note: slim(r.note, 240) })) }),
          });
          const body = await res.json().catch(() => ({}));
          p.calls++;
          if (res.ok) {
            const upd = new Map<string, { code: CorrectedCode; evidence: string; source: "llm" }>();
            const byId = new Map<string, Refund>(batch.map((r) => [r.ticket_id, r]));
            for (const v of body.results as { id: string; code: CorrectedCode; evidence: string }[]) {
              upd.set(v.id, { code: v.code, evidence: v.evidence, source: "llm" });
              const r = byId.get(v.id);
              if (r) cache[keyOf(r)] = { code: v.code, evidence: v.evidence };
            }
            p.tokens += body.tokens || 0;
            p.done += batch.length;
            saveCache(cache);
            if (upd.size) onUpdate(upd);
            p.state = "running";
            const rate = p.done - p.cached > 0 ? (Date.now() - t0) / (p.done - p.cached) : 0;
            p.etaSec = Math.round((rate * (p.total - p.done)) / 1000);
            emit();
            break;
          }
          if (res.status === 429) {
            const wait = Math.min(90, Math.max(5, body.retryAfter || 20 * attempt));
            p.state = "paused-rate";
            p.message = `Groq free-tier limit reached, resuming in ${wait}s. Nothing is lost.`;
            emit();
            await sleep(wait * 1000, signal);
            p.state = "running"; p.message = undefined;
            if (attempt >= 8) { p.done += batch.length; break; }
            continue;
          }
          if (body.error === "no-key" || body.error === "bad-key" || body.error === "access-code") {
            fatal = "no-key"; p.state = "no-key"; p.message = body.message; emit(); return;
          }
          if (attempt >= 3) { p.done += batch.length; p.message = "Some batches failed; those tickets keep the rules verdict."; emit(); break; }
          await sleep(1500 * attempt, signal);
        } catch {
          if (signal.aborted) return;
          if (attempt >= 3) { p.done += batch.length; p.message = "Network trouble; affected tickets keep the rules verdict."; emit(); break; }
          await sleep(1500 * attempt, signal);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  p.state = signal.aborted ? "stopped" : fatal ?? "done";
  p.etaSec = 0;
  emit();
  return p;
}

/** Instantly re-applies any verdicts already paid for on a previous run of the same file. */
export function cachedVerdicts(refunds: Refund[]): Map<string, { code: CorrectedCode; evidence: string; source: "llm" }> {
  const cache = loadCache();
  const out = new Map<string, { code: CorrectedCode; evidence: string; source: "llm" }>();
  for (const r of refunds) {
    if (!needsLlm(r)) continue;
    const c = cache[keyOf(r)];
    if (c) out.set(r.ticket_id, { ...c, source: "llm" });
  }
  return out;
}
