export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;

export const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};
