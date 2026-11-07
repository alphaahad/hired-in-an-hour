// Field mapping: NetSuite-shaped source fields -> the AP employee's canonical schema.
// Layer 1 (here, deterministic): name + synonym similarity, value-pattern profiling, and a
// referential check (do the values exist as keys in another record?).
// Layer 2 (llm.ts): the LLM only *suggests* for fields layer 1 cannot verify; a human approves.
import { itemReceipts, purchaseOrders, vendorBills, vendors } from "@/data/seed";

export type RecordType = "vendor" | "purchaseOrder" | "itemReceipt" | "vendorBill";

export type SourceField = { key: string; record: RecordType; field: string; type: "text" | "date" | "number"; samples: string[] };

export type TargetField = {
  key: string;
  label: string;
  record: RecordType;
  type: SourceField["type"];
  required: boolean;
  synonyms: string[];
  pattern?: RegExp;
  refersTo?: { record: RecordType; field: string }; // values must exist there
  why: string; // what the AP employee uses it for
};

export const IGNORE = "__ignore";

// Canonical AP schema. GUESS: Zamp's internal schema is not public; this is a reasonable
// AP-matching schema, tracked in DECISIONS.md.
export const targets: TargetField[] = [
  { key: "vendor_code", label: "Vendor ID", record: "vendor", type: "text", required: true, synonyms: ["entity", "entityid", "vendor", "id", "code"], pattern: /^[A-Z][A-Z-]+$/, why: "Join key for vendor master" },
  { key: "vendor_name", label: "Vendor legal name", record: "vendor", type: "text", required: true, synonyms: ["company", "name", "companyname", "legal"], why: "Fallback vendor matching when tax ID is unreadable" },
  { key: "vendor_tax_id", label: "Vendor tax ID (GSTIN)", record: "vendor", type: "text", required: true, synonyms: ["gstin", "tax", "gst", "vat", "pan"], pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9][A-Z0-9]$/, why: "Primary key for matching invoices to vendors" },
  { key: "payment_terms", label: "Payment terms", record: "vendor", type: "text", required: false, synonyms: ["terms", "payment"], pattern: /^Net \d+$/, why: "Due-date checks" },

  { key: "po_number", label: "PO number", record: "purchaseOrder", type: "text", required: true, synonyms: ["tranid", "number", "po", "document"], pattern: /^PO-\d+$/, why: "Invoices quote it; the match starts here" },
  { key: "po_date", label: "PO date", record: "purchaseOrder", type: "date", required: false, synonyms: ["trandate", "date"], pattern: /^\d{4}-\d{2}-\d{2}$/, why: "Ageing and audit" },
  { key: "cost_center", label: "Cost centre", record: "purchaseOrder", type: "text", required: false, synonyms: ["cost", "center", "centre", "cc"], pattern: /^CC-[A-Z]+-\d+$/, why: "Coding the bill to the right budget owner" },
  { key: "po_gl_account", label: "GL account", record: "purchaseOrder", type: "text", required: true, synonyms: ["account", "gl", "ledger", "expense"], pattern: /^\d{4}$/, why: "Default expense coding for the bill" },
  { key: "po_unit_price", label: "Agreed unit price", record: "purchaseOrder", type: "number", required: true, synonyms: ["rate", "price", "unit"], why: "Price leg of the 3-way match" },
  { key: "po_quantity", label: "Ordered quantity", record: "purchaseOrder", type: "number", required: true, synonyms: ["quantity", "qty", "ordered"], why: "Quantity leg of the 3-way match" },

  { key: "receipt_number", label: "Goods receipt number", record: "itemReceipt", type: "text", required: true, synonyms: ["tranid", "number", "grn", "receipt"], pattern: /^GRN-\d+$/, why: "Proof goods arrived" },
  { key: "receipt_po", label: "Receipt → PO link", record: "itemReceipt", type: "text", required: true, synonyms: ["createdfrom", "source", "po", "created"], pattern: /^PO-\d+$/, refersTo: { record: "purchaseOrder", field: "tranId" }, why: "Ties the receipt to the PO" },
  { key: "received_quantity", label: "Received quantity", record: "itemReceipt", type: "number", required: true, synonyms: ["quantity", "qty", "received"], why: "Receipt leg of the 3-way match" },

  { key: "invoice_number", label: "Vendor invoice number", record: "vendorBill", type: "text", required: true, synonyms: ["tranid", "number", "invoice", "bill"], why: "Duplicate detection" },
  { key: "bill_vendor", label: "Bill → vendor link", record: "vendorBill", type: "text", required: true, synonyms: ["entity", "vendor"], pattern: /^V-\d+$/, refersTo: { record: "vendor", field: "id" }, why: "Duplicate detection is per vendor" },
  { key: "invoice_date", label: "Invoice date", record: "vendorBill", type: "date", required: true, synonyms: ["trandate", "date", "invoice"], pattern: /^\d{4}-\d{2}-\d{2}$/, why: "Duplicate window, ageing" },
  { key: "due_date", label: "Due date", record: "vendorBill", type: "date", required: false, synonyms: ["duedate", "due"], pattern: /^\d{4}-\d{2}-\d{2}$/, why: "Payment scheduling" },
  { key: "bill_po", label: "Bill → PO link", record: "vendorBill", type: "text", required: true, synonyms: ["po", "purchase", "order", "createdfrom"], pattern: /^PO-\d+$/, refersTo: { record: "purchaseOrder", field: "tranId" }, why: "Which PO a historical bill consumed" },
  { key: "bill_gl_account", label: "GL account", record: "vendorBill", type: "text", required: true, synonyms: ["account", "gl", "ledger", "expense"], pattern: /^\d{4}$/, why: "Expense coding" },
  { key: "bill_total", label: "Bill total", record: "vendorBill", type: "number", required: true, synonyms: ["usertotal", "total", "amount"], why: "Duplicate detection (same vendor, same amount)" },
  { key: "currency", label: "Currency", record: "vendorBill", type: "text", required: true, synonyms: ["currency", "curr"], pattern: /^[A-Z]{3}$/, why: "Multi-currency guard" },
];

const recordsOf = (r: RecordType): Record<string, unknown>[] =>
  ({ vendor: vendors, purchaseOrder: purchaseOrders, itemReceipt: itemReceipts, vendorBill: vendorBills })[r] as unknown as Record<string, unknown>[];

function valuesOf(record: RecordType, path: string): string[] {
  const [head, sub] = path.split(".");
  return recordsOf(record).flatMap((rec) => {
    const v = rec[head];
    if (sub && Array.isArray(v)) return v.map((x) => String((x as Record<string, unknown>)[sub]));
    return [String(v ?? "")];
  });
}

const SOURCE_DEFS: [RecordType, string, SourceField["type"]][] = [
  ["vendor", "entityId", "text"], ["vendor", "companyName", "text"], ["vendor", "custentity_gstin", "text"], ["vendor", "terms", "text"],
  ["purchaseOrder", "tranId", "text"], ["purchaseOrder", "tranDate", "date"], ["purchaseOrder", "custbody_dept_code", "text"], ["purchaseOrder", "account", "text"],
  ["purchaseOrder", "item.rate", "number"], ["purchaseOrder", "item.quantity", "number"],
  ["itemReceipt", "tranId", "text"], ["itemReceipt", "createdFrom", "text"], ["itemReceipt", "item.quantity", "number"],
  ["vendorBill", "tranId", "text"], ["vendorBill", "entity", "text"], ["vendorBill", "trandate", "date"], ["vendorBill", "duedate", "date"],
  ["vendorBill", "custbody_ref1", "text"], ["vendorBill", "custbody_svc_date", "date"], ["vendorBill", "account", "text"],
  ["vendorBill", "usertotal", "number"], ["vendorBill", "currency", "text"],
];

export const sourceFields: SourceField[] = SOURCE_DEFS.map(([record, field, type]) => ({
  key: `${record}.${field}`, record, field, type, samples: [...new Set(valuesOf(record, field))].slice(0, 4),
}));

/** "custbody_dept_code" -> ["dept","code"]; "tranDate" -> ["tran","date","trandate"] */
export function fieldTokens(field: string) {
  const last = field.split(".").pop()!;
  const stripped = last.replace(/^cust(body|entity|col)_/, "");
  const parts = stripped.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_]+/).filter(Boolean);
  return new Set([...parts, stripped.toLowerCase().replace(/_/g, "")]);
}

const GENERIC = new Set(["date", "number", "id", "code", "name", "amount"]);

export type Candidate = {
  target: string;
  confidence: number;
  signals: { name: number; pattern: number | null; reference: number | null; type: number };
  reason: string;
};

export function scoreField(s: SourceField): Candidate[] {
  const all = valuesOf(s.record, s.field).filter((v) => v !== "");
  const toks = fieldTokens(s.field);
  return targets
    .filter((t) => t.record === s.record)
    .map((t) => {
      const whole = s.field.split(".").pop()!.replace(/^cust(body|entity|col)_/, "").toLowerCase().replace(/_/g, "");
      // Exact standard name > specific token > generic token ("date", "code" say little on their own)
      const name = t.synonyms.includes(whole) || whole === t.key.replace(/_/g, "")
        ? 1
        : Math.max(0, ...t.synonyms.filter((x) => toks.has(x)).map((x) => (GENERIC.has(x) ? 0.4 : 0.8)));
      const pattern = t.pattern
        ? all.filter((v) => t.pattern!.test(v)).length / Math.max(1, all.length)
        : t.type === "number"
          ? all.filter((v) => v.trim() !== "" && !isNaN(Number(v))).length / Math.max(1, all.length)
          : null;
      let reference: number | null = null;
      if (t.refersTo) {
        const keys = new Set(valuesOf(t.refersTo.record, t.refersTo.field));
        reference = all.filter((v) => keys.has(v)).length / Math.max(1, all.length);
      }
      const type = t.type === s.type ? 1 : 0;
      // Weighting: names in ERPs lie (custom fields), values rarely do — but values alone are
      // ambiguous (two date fields look identical), so a name signal is needed to auto-approve.
      const evidence = [pattern, reference].filter((x): x is number => x !== null);
      const valueScore = evidence.length ? evidence.reduce((a, b) => a + b, 0) / evidence.length : 0.5;
      const confidence = type === 0 ? 0.05 : Math.round((0.55 * name + 0.35 * valueScore + 0.1 * type) * 100) / 100;
      const bits: string[] = [];
      bits.push(name >= 0.5 ? `name matches "${t.label}"` : name > 0 ? `name partly matches "${t.label}"` : "name gives no signal");
      if (pattern !== null) bits.push(`${Math.round(pattern * 100)}% of values fit the ${t.label} format`);
      if (reference !== null && t.refersTo) bits.push(`${Math.round(reference * 100)}% of values exist as ${t.refersTo.record}.${t.refersTo.field}`);
      return { target: t.key, confidence, signals: { name, pattern, reference, type }, reason: bits.join("; ") };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export const AUTO_APPROVE_AT = 0.8;

export type Proposal = {
  source: SourceField;
  best: Candidate | null;
  runnerUp: Candidate | null;
  status: "auto" | "needs_review";
};

export function proposeMappings(): Proposal[] {
  const proposals = sourceFields.map((s) => {
    const [best, runnerUp] = scoreField(s);
    return { source: s, best: best ?? null, runnerUp: runnerUp ?? null, status: "needs_review" as Proposal["status"] };
  });
  // A target can be claimed by only one source: the strongest claim wins, the rest go to review.
  const winner = new Map<string, Proposal>();
  proposals.forEach((p) => {
    if (!p.best) return;
    const cur = winner.get(p.best.target);
    if (!cur || p.best.confidence > cur.best!.confidence) winner.set(p.best.target, p);
  });
  proposals.forEach((p) => {
    if (!p.best) return;
    const w = winner.get(p.best.target)!;
    if (w !== p) {
      p.best = { ...p.best, confidence: Math.min(p.best.confidence, 0.5), reason: `${p.best.reason}; but ${w.source.key} is a stronger match for ${targetByKey(p.best.target)?.label}, so this field may not be needed` };
    } else if (p.best.confidence >= AUTO_APPROVE_AT) p.status = "auto";
  });
  return proposals;
}

export const targetByKey = (k: string) => targets.find((t) => t.key === k);
