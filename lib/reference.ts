import Papa from "papaparse";
import type { Agent, Order, Product } from "./types";

export interface Reference {
  agents: Record<string, Agent>;
  products: Record<string, Product>;
  orders: Order[];
  ordersById: Record<string, Order>;
  ordersByCustSku: Record<string, Order[]>;
}

async function load<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  return Papa.parse<T>(text, { header: true, skipEmptyLines: true, dynamicTyping: false }).data;
}

export function buildReference(
  agents: Record<string, string>[],
  products: Record<string, string>[],
  orders: Record<string, string>[],
): Reference {
  const a: Record<string, Agent> = {};
  for (const r of agents) a[r.agent_id] = r as unknown as Agent; // roster: one row per agent in this pack
  const p: Record<string, Product> = {};
  for (const r of products)
    p[r.sku] = { ...r, unit_cost_inr: Number(r.unit_cost_inr), retail_price_inr: Number(r.retail_price_inr) } as unknown as Product;
  const os: Order[] = orders.map((r) => ({
    order_id: r.order_id, customer_id: r.customer_id, sku: r.sku, order_date: r.order_date,
    channel: r.channel, qty: Number(r.qty), order_value_inr: Number(r.order_value_inr), lot_code: r.lot_code,
  }));
  const byId: Record<string, Order> = {};
  const byCS: Record<string, Order[]> = {};
  for (const o of os) {
    byId[o.order_id] = o;
    (byCS[o.customer_id + "|" + o.sku] ||= []).push(o);
  }
  return { agents: a, products: p, orders: os, ordersById: byId, ordersByCustSku: byCS };
}

let cache: Promise<Reference> | null = null;

/** Reference data ships with the app (public/ref). Loaded once, in the browser. */
export function loadReference(): Promise<Reference> {
  if (cache) return cache;
  cache = (async () => {
    const [agents, products, orders] = await Promise.all([
      load<Record<string, string>>("/ref/agents.csv"),
      load<Record<string, string>>("/ref/products.csv"),
      load<Record<string, string>>("/ref/orders.csv"),
    ]);
    return buildReference(agents, products, orders);
  })().catch((e) => {
    cache = null; // allow retry
    throw e;
  });
  return cache;
}

/** order_id if quoted, otherwise customer_id + sku fallback (latest order on/before the ticket date). */
export function matchOrder(ref: Reference, orderId: string, customerId: string, sku: string, createdIso: string): Order | null {
  if (orderId && ref.ordersById[orderId]) return ref.ordersById[orderId];
  const list = ref.ordersByCustSku[customerId + "|" + sku];
  if (!list?.length) return null;
  const day = createdIso.slice(0, 10);
  let best: Order | null = null;
  for (const o of list) if (o.order_date <= day && (!best || o.order_date > best.order_date)) best = o;
  return best;
}
