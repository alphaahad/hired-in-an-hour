// The employee's voice. Pure functions that turn real records (audit actions, extractions,
// match checks) into first-person lines. Nothing here invents work: every line is derived from
// something the system actually did. Shared by the browser (Desk) and the server (vendor drafts).
import type { CheckResult, Extraction, MatchResult } from "./types";
import { duration, inr, shortDate } from "./format";

export const BUYER = "Acme Fulfilment India (mock)";

// ---------- persona ----------

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A calm, stable colour per name, so the same employee always looks the same. */
const HUES = [
  { bg: "#4338ca", soft: "#eef2ff", ink: "#3730a3" }, // indigo
  { bg: "#0f766e", soft: "#f0fdfa", ink: "#115e59" }, // teal
  { bg: "#7c3aed", soft: "#f5f3ff", ink: "#6d28d9" }, // violet
  { bg: "#b45309", soft: "#fffbeb", ink: "#92400e" }, // amber
  { bg: "#be185d", soft: "#fdf2f8", ink: "#9d174d" }, // rose
  { bg: "#0369a1", soft: "#f0f9ff", ink: "#075985" }, // sky
];
export function personaColour(name: string) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

// ---------- the feed, rebuilt from the audit trail ----------

export type ActionLike = {
  id: string; ts: string; actor: string; type: string; target: string; summary: string;
  evidence: unknown; before: unknown; after: unknown; reversed_by?: string | null;
};

export type InvoiceFacts = { id: string; vendor: string; number: string | null; total: number | null; poId: string | null; receiptIds: string[] };

export type FeedLine = {
  id: string;
  ts: string;
  who: "employee" | "you";
  tone: "info" | "ok" | "warn" | "bad" | "celebrate";
  text: string;
  href?: string;
};

type Ctx = {
  name: string;
  hiredAt: string | null;
  invoice: (id: string) => InvoiceFacts | undefined;
  mapping?: { auto: number; total: number; review: number };
};

const shortVendor = (v: string) => v.replace(/ Pvt Ltd$/, "");
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function feedFromActions(actions: ActionLike[], ctx: Ctx): FeedLine[] {
  const out: FeedLine[] = [];
  const line = (a: ActionLike, l: Omit<FeedLine, "id" | "ts">, suffix = "") => out.push({ id: a.id + suffix, ts: a.ts, ...l });
  if (ctx.hiredAt) {
    out.push({ id: "hired", ts: ctx.hiredAt, who: "employee", tone: "info", text: `Hi, I'm ${ctx.name}, your new AP specialist. First I need read-only access to your NetSuite.` });
  }
  let seenSync = false;
  let seenFirstBill = false;
  const sorted = [...actions].sort((a, b) => a.ts.localeCompare(b.ts));
  for (const a of sorted) {
    const after = obj(a.after), ev = obj(a.evidence);
    const invId = a.target.startsWith("invoice:") ? a.target.slice(8) : "";
    const inv = invId ? ctx.invoice(invId) : undefined;
    const num = inv?.number ?? invId;
    switch (a.type) {
      case "erp_connected": {
        const c = obj(after.counts);
        line(a, { who: "employee", tone: "ok", text: `I'm in, read-only. NetSuite sandbox ${after.accountId ?? ""} has ${c.vendor} vendors, ${c.purchaseOrder} purchase orders, ${c.itemReceipt} goods receipts and ${c.vendorBill} past bills.` });
        if (ctx.mapping) {
          const m = ctx.mapping;
          line(a, {
            who: "employee", tone: "info",
            text: m.review
              ? `I mapped ${m.auto} of ${m.total} fields to how I work. ${m.review} are custom fields I can't be sure about, so I've asked you.`
              : `I mapped all ${m.total} fields to how I work.`,
          }, ":map");
        }
        break;
      }
      case "mapping_decision": {
        // Stored as "Approved vendorBill.custbody_ref1 → Bill → PO link" (or "Changed …", or "… → not needed (ignored)").
        const m = a.summary.match(/^(Approved|Changed) \w+\.([\w.]+) → (.+)$/);
        const text = !m ? a.summary
          : m[3].startsWith("not needed") ? `Skipped ${m[2]}: not needed.`
          : `${m[1] === "Approved" ? "Confirmed" : "Corrected"}: ${m[2]} is the ${m[3]}.`;
        line(a, { who: "you", tone: "info", text });
        break;
      }
      case "mapping_reverted":
        line(a, { who: "you", tone: "info", text: a.summary });
        break;
      case "sync_run": {
        const total = Number(after.total ?? 0), ok = Number(after.ok ?? 0), failed = Number(after.failed ?? 0);
        const failures = (after.failures as { id: string; error: string }[] | undefined) ?? [];
        // Mid-sentence casing, but keep acronyms ("GL account is empty" stays "GL").
        const reasons = [...new Set(failures.map((f) => (/^[A-Z]{2}/.test(f.error) ? f.error : f.error.charAt(0).toLowerCase() + f.error.slice(1))))];
        line(a, {
          who: "employee", tone: failed ? "warn" : "ok",
          text: failed
            ? `Test sync done: ${ok} of ${total} records in. ${failed} old bill${failed > 1 ? "s" : ""} (${failures.map((f) => f.id).join(", ")}) ${reasons.length === 1 ? `had a problem: ${reasons[0]}` : "had problems"}, so I set ${failed > 1 ? "them" : "it"} aside. They won't block me.`
            : `Test sync done: all ${total} records in.`,
        });
        if (!seenSync) line(a, { who: "employee", tone: "info", text: "I'm ready. There are 20 invoices in the inbox; I'll work through them and bring you anything I'm not sure about." }, ":ready");
        seenSync = true;
        break;
      }
      case "sync_undone":
        line(a, { who: "you", tone: "info", text: "You undid the test sync. NetSuite was never written to." });
        line(a, { who: "employee", tone: "warn", text: "I've stopped working until we sync again." }, ":paused");
        break;
      case "invoice_matched": {
        const checks = (ev.checks as CheckResult[] | undefined) ?? [];
        const failed = checks.filter((c) => c.status === "fail");
        const head = `${num}${inv ? ` from ${shortVendor(inv.vendor)}` : ""}${inv?.total != null ? `, ${inr(inv.total)}` : ""}`;
        line(a, after.status === "matched"
          ? { who: "employee", tone: "ok", text: `${head}: matches ${inv?.poId ?? "the PO"}${inv?.receiptIds.length ? ` and ${inv.receiptIds.join(", ")}` : ""}. Ready to post.`, href: `/employee/${invId}` }
          : { who: "employee", tone: "bad", text: `${head}: I stopped. ${failed[0]?.detail ?? a.summary}`, href: `/employee/${invId}` });
        break;
      }
      case "bill_posted": {
        const billId = String(after.bill_id ?? "");
        const override = obj(ev).decision === "override";
        if (!seenFirstBill && ctx.hiredAt) {
          const took = new Date(a.ts).getTime() - new Date(ctx.hiredAt).getTime();
          line(a, { who: "employee", tone: "celebrate", text: `Posted ${billId} to NetSuite for ${num}. That's my first bill: hired to productive in ${duration(took)}.`, href: `/employee/${invId}` });
        } else {
          line(a, { who: "employee", tone: "ok", text: override ? `Posted ${billId} for ${num}, overriding the exception as you asked: "${obj(ev).note}".` : `Posted ${billId} for ${num}.`, href: `/employee/${invId}` });
        }
        seenFirstBill = true;
        break;
      }
      case "invoice_held":
        line(a, { who: "employee", tone: "warn", text: `${num} is on hold. My query to ${inv ? shortVendor(inv.vendor) : "the vendor"} is drafted (not sent: email is out of scope in this prototype).`, href: `/employee/${invId}` });
        break;
      case "invoice_rejected":
        line(a, { who: "you", tone: "info", text: `You rejected ${num}. No bill was created.`, href: `/employee/${invId}` });
        break;
      case "bill_voided":
        line(a, { who: "employee", tone: "warn", text: `You reversed ${obj(a.before).bill_id ?? "the bill"}. I voided it in NetSuite; the original stays in the audit trail.`, href: `/employee/${invId}` });
        break;
      case "decision_reversed":
        line(a, { who: "you", tone: "info", text: `You reversed the decision on ${num}. It's back in my queue for you.`, href: `/employee/${invId}` });
        break;
    }
  }
  return out;
}

// ---------- live narration of one invoice ----------

export type LiveStep = { text: string; status: "doing" | "pass" | "warn" | "fail" | "info"; highlight?: string[] };

const money = (v: string) => v.replace(/[₹,\s]|Rs\.?/g, "");

/** The steps the employee narrates while working an invoice, in order, with what to highlight on the PDF. */
export function liveSteps(file: string, ex: Extraction, match: MatchResult, meta: { source: string | null; ms: number }): LiveStep[] {
  const src = meta.source === "live" ? "Gemini · live" : meta.source === "cached" ? "Gemini · cached" : "precomputed fallback";
  const q = ex.evidence ?? {};
  const steps: LiveStep[] = [
    { text: `Read ${file}: ${ex.invoice_number}, ${inr(ex.total)}, dated ${shortDate(ex.invoice_date)}. (${src}, ${(meta.ms / 1000).toFixed(1)}s)`, status: "info", highlight: [q.invoice_number, q.invoice_date, q.total].filter(Boolean) as string[] },
  ];
  for (const c of match.checks) {
    const hl: string[] = [];
    if (c.id === "vendor" && q.vendor_tax_id) hl.push(q.vendor_tax_id);
    if (c.id === "po" && q.po_number) hl.push(q.po_number);
    if (c.status === "fail" || c.status === "warn") for (const ci of c.citations) if (ci.doc.startsWith("Invoice")) hl.push(money(ci.value));
    steps.push({ text: `${c.label}. ${c.detail}`, status: c.status === "skip" ? "info" : c.status, highlight: hl });
  }
  steps.push(match.status === "matched"
    ? { text: "Everything checks out. I'll ask you before posting it.", status: "pass" }
    : { text: "Stopping here. I need you on this one.", status: "fail" });
  return steps;
}

// ---------- vendor query draft ----------

const ASK: Record<string, string> = {
  price_mismatch: "Please send a credit note for the difference, or a revised invoice at the PO rate.",
  missing_receipt: "We have no goods receipt against this order yet. Could you share the delivery note or proof of delivery?",
  duplicate: "This looks like a copy of an invoice we've already paid. Please confirm, or let us know what's different.",
  quantity_variance: "Please bill only for the quantity we've received, or tell us when the rest will be delivered.",
};

export function draftVendorQuery(employeeName: string, vendor: string, ex: Extraction, match: MatchResult) {
  const asks = [...new Set(match.exceptions.map((e) => ASK[e.exceptionType ?? ""] ?? "Could you check and send a corrected invoice?"))];
  const subject = `Invoice ${ex.invoice_number}: a question before we pay`;
  const body = [
    `Hello ${shortVendor(vendor)} accounts team,`,
    "",
    `We received invoice ${ex.invoice_number} dated ${shortDate(ex.invoice_date)} for ${inr(ex.total)}${ex.po_number ? ` against ${ex.po_number}` : ""}. Before we can pay it:`,
    "",
    ...match.exceptions.map((e) => `• ${e.detail}`),
    "",
    ...asks,
    "",
    "Thanks,",
    employeeName,
    `AP Specialist, ${BUYER}`,
  ].join("\n");
  return { subject, body };
}
