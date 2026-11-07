import { Badge, type Tone } from "./ui";

export const STATUS: Record<string, { tone: Tone; label: string }> = {
  queued: { tone: "neutral", label: "In inbox" },
  processing: { tone: "accent", label: "Reading…" },
  matched: { tone: "accent", label: "Matched · awaiting you" },
  exception: { tone: "bad", label: "Exception · awaiting you" },
  posted: { tone: "ok", label: "Bill posted" },
  on_hold: { tone: "warn", label: "On hold" },
  rejected: { tone: "neutral", label: "Rejected" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status };
  // Keyed by status: when an invoice changes state the chip cross-fades instead of snapping.
  return <Badge key={status} tone={s.tone} className="animate-swap">{s.label}</Badge>;
}

export const EXCEPTION_LABEL: Record<string, string> = {
  price_mismatch: "Price above PO",
  missing_receipt: "No goods receipt",
  duplicate: "Duplicate invoice",
  quantity_variance: "Billed > received",
  unknown_vendor: "Unknown vendor",
  unknown_po: "Unknown PO",
  arithmetic: "Totals don't add up",
};
