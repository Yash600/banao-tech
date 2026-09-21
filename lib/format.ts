const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const inr = (n: number) => (n < 0 ? "−₹" : "₹") + inrFmt.format(Math.abs(Math.round(n)));
export const num = (n: number) => inrFmt.format(Math.round(n));
/** ₹51.1 lakh / ₹14.9 crore: the way Finance actually says it */
export function inrShort(n: number): string {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} crore`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} lakh`;
  return `${s}₹${inrFmt.format(Math.round(a))}`;
}
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) => `${MON[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
export const monthLong = (m: string) => `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
