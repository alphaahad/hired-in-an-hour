// 3-way match engine: invoice (what the vendor says) vs purchase order (what we agreed)
// vs item receipt (what actually arrived). Pure functions — no I/O — so it is unit-tested
// and the agent's decision can be replayed from stored inputs.
import type { CheckResult, Citation, Extraction, ItemReceipt, MatchResult, PurchaseOrder, Vendor, VendorBill } from "./types";
import { inr, pct, shortDate } from "./format";

export type Tolerances = {
  pricePct: number; // allowed unit-price increase over PO, e.g. 0.02
  overReceiptQty: number; // units billed beyond received; 0 = must not bill more than received
  arithmeticAbs: number; // rounding slack in INR
};
export const DEFAULT_TOLERANCES: Tolerances = { pricePct: 0.02, overReceiptQty: 0, arithmeticAbs: 1 };

export type PriorInvoice = { invoiceId: string; vendorId: string; invoice_number: string; total: number; date: string };

export type MatchContext = {
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  receipts: ItemReceipt[];
  bills: VendorBill[]; // bills already in the ERP (paid or open)
  priorInvoices: PriorInvoice[]; // invoices this employee already processed (in-batch duplicates)
  tolerances?: Tolerances;
};

/** "MDI-0042", "mdi 42", "MDI42" -> "MDI42". Vendors re-key invoice numbers all the time. */
export function normalizeInvoiceNumber(s: string) {
  return s
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((seg) => seg.replace(/(^|[A-Z])0+(\d)/g, "$1$2")) // leading zeros of each numeric run
    .join("");
}
const normTax = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normPo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !["pvt", "ltd", "private", "limited", "llp", "inc"].includes(t)));
export function nameSimilarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.max(1, Math.max(A.size, B.size));
}

export function threeWayMatch(invoiceId: string, ex: Extraction, ctx: MatchContext): MatchResult {
  const tol = ctx.tolerances ?? DEFAULT_TOLERANCES;
  const invDoc = `Invoice ${ex.invoice_number}`;
  const checks: CheckResult[] = [];
  const result: MatchResult = { status: "matched", vendorId: null, poId: null, receiptIds: [], checks, exceptions: [], lineTable: [] };

  // 1. Vendor
  let vendor = ctx.vendors.find((v) => normTax(v.custentity_gstin) === normTax(ex.vendor_tax_id));
  let how = "GSTIN";
  if (!vendor) {
    const best = ctx.vendors.map((v) => ({ v, s: nameSimilarity(v.companyName, ex.vendor_name) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.75) { vendor = best.v; how = "name"; }
  }
  if (vendor) {
    result.vendorId = vendor.id;
    checks.push({
      id: "vendor", label: "Vendor identified", status: how === "GSTIN" ? "pass" : "warn",
      detail: `${vendor.companyName} (${vendor.id}) matched on ${how}${how === "name" ? " only. GSTIN on invoice did not match vendor master" : ""}.`,
      citations: [{ doc: invDoc, field: how === "GSTIN" ? "GSTIN" : "vendor name", value: how === "GSTIN" ? ex.vendor_tax_id : ex.vendor_name, against: { doc: `NetSuite vendor ${vendor.id}`, field: how === "GSTIN" ? "custentity_gstin" : "companyName", value: how === "GSTIN" ? vendor.custentity_gstin : vendor.companyName } }],
    });
  } else {
    checks.push({
      id: "vendor", label: "Vendor identified", status: "fail", exceptionType: "unknown_vendor", rule: "Vendor must exist in the vendor master",
      detail: `No vendor in NetSuite matches GSTIN ${ex.vendor_tax_id} or name "${ex.vendor_name}".`,
      citations: [{ doc: invDoc, field: "GSTIN", value: ex.vendor_tax_id }],
    });
  }

  // 2. Duplicate — against bills already in the ERP and invoices processed earlier in this batch
  if (vendor) {
    const n = normalizeInvoiceNumber(ex.invoice_number);
    const billHit = ctx.bills.find((b) => b.entity === vendor!.id && normalizeInvoiceNumber(b.tranId) === n);
    const priorHit = ctx.priorInvoices.find((p) => p.invoiceId !== invoiceId && p.vendorId === vendor!.id && normalizeInvoiceNumber(p.invoice_number) === n);
    if (billHit) {
      const sameTotal = Math.abs(billHit.usertotal - ex.total) <= tol.arithmeticAbs;
      checks.push({
        id: "duplicate", label: "Not a duplicate", status: "fail", exceptionType: "duplicate",
        rule: "Invoice number (normalised) must be unique per vendor",
        detail: `${invDoc} normalises to ${n}, the same as NetSuite bill ${billHit.tranId} (${billHit.status === "paidInFull" ? "already paid" : billHit.status}, dated ${shortDate(billHit.trandate)})${sameTotal ? `, with the same total of ${inr(ex.total)}` : ""}. Paying it would pay this vendor twice.`,
        citations: [
          { doc: invDoc, field: "invoice number", value: ex.invoice_number, against: { doc: `NetSuite bill ${billHit.id}`, field: "tranId", value: billHit.tranId } },
          ...(sameTotal ? [{ doc: invDoc, field: "total", value: inr(ex.total), against: { doc: `NetSuite bill ${billHit.id}`, field: "usertotal", value: inr(billHit.usertotal) } }] : []),
        ],
      });
    } else if (priorHit) {
      checks.push({
        id: "duplicate", label: "Not a duplicate", status: "fail", exceptionType: "duplicate", rule: "Invoice number (normalised) must be unique per vendor",
        detail: `${invDoc} has the same normalised number as ${priorHit.invoice_number}, which was already processed in this batch.`,
        citations: [{ doc: invDoc, field: "invoice number", value: ex.invoice_number, against: { doc: `Invoice ${priorHit.invoice_number}`, field: "invoice number", value: priorHit.invoice_number } }],
      });
    } else {
      checks.push({ id: "duplicate", label: "Not a duplicate", status: "pass", detail: `No bill or prior invoice from this vendor normalises to ${n}.`, citations: [] });
    }
  }

  // 3. Purchase order
  const po = ctx.purchaseOrders.find((p) => normPo(p.tranId) === normPo(ex.po_number));
  if (!po) {
    checks.push({
      id: "po", label: "Purchase order found", status: "fail", exceptionType: "unknown_po", rule: "Invoice must reference an open PO",
      detail: `PO "${ex.po_number}" quoted on the invoice does not exist in NetSuite.`, citations: [{ doc: invDoc, field: "PO reference", value: ex.po_number }],
    });
  } else if (vendor && po.entity !== vendor.id) {
    checks.push({
      id: "po", label: "Purchase order found", status: "fail", exceptionType: "unknown_po", rule: "PO vendor must equal invoice vendor",
      detail: `${po.tranId} belongs to vendor ${po.entity}, not ${vendor.id}.`,
      citations: [{ doc: invDoc, field: "PO reference", value: ex.po_number, against: { doc: `NetSuite ${po.tranId}`, field: "entity", value: po.entity } }],
    });
  } else {
    result.poId = po.tranId;
    checks.push({ id: "po", label: "Purchase order found", status: "pass", detail: `${po.tranId} raised ${shortDate(po.tranDate)} for ${vendor?.companyName ?? po.entity}.`, citations: [{ doc: invDoc, field: "PO reference", value: ex.po_number, against: { doc: `NetSuite ${po.tranId}`, field: "tranId", value: po.tranId } }] });
  }

  // 4. Goods receipt
  const receipts = po ? ctx.receipts.filter((r) => r.createdFrom === po.tranId) : [];
  result.receiptIds = receipts.map((r) => r.tranId);
  if (po) {
    if (receipts.length === 0) {
      checks.push({
        id: "receipt", label: "Goods received", status: "fail", exceptionType: "missing_receipt", rule: "Goods must be received before the bill is paid",
        detail: `No item receipt in NetSuite references ${po.tranId}. The vendor is billing for goods the warehouse has not recorded as received.`,
        citations: [{ doc: `NetSuite itemReceipt`, field: "createdFrom", value: `no record = ${po.tranId}`, against: { doc: invDoc, field: "PO reference", value: ex.po_number } }],
      });
    } else {
      checks.push({ id: "receipt", label: "Goods received", status: "pass", detail: `${receipts.map((r) => `${r.tranId} (${shortDate(r.tranDate)})`).join(", ")}.`, citations: [] });
    }
  }

  // 5. Line-level price and quantity
  if (po) {
    const priceCits: Citation[] = [], qtyCits: Citation[] = [];
    const priceDetails: string[] = [], qtyDetails: string[] = [], priceNotes: string[] = [];
    ex.lines.forEach((l, i) => {
      const lineNo = i + 1;
      const poLine = po.item.find((p) => p.item === l.item_code);
      const received = receipts.length ? receipts.flatMap((r) => r.item).filter((r) => r.item === l.item_code).reduce((s, r) => s + r.quantity, 0) : null;
      result.lineTable.push({ line: lineNo, item: l.item_code, invoice: { qty: l.quantity, price: l.unit_price }, po: poLine ? { qty: poLine.quantity, price: poLine.rate } : null, received });
      if (!poLine) {
        priceDetails.push(`line ${lineNo} (${l.item_code}) is not on ${po.tranId}`);
        priceCits.push({ doc: invDoc, field: `line ${lineNo} · item`, value: l.item_code, against: { doc: `NetSuite ${po.tranId}`, field: "items", value: po.item.map((p) => p.item).join(", ") } });
        return;
      }
      const variance = (l.unit_price - poLine.rate) / poLine.rate;
      if (variance > tol.pricePct + 1e-9) {
        priceDetails.push(`line ${lineNo} (${l.item_code}) unit price ${inr(l.unit_price)} vs PO ${inr(poLine.rate)}, ${pct(variance)} exceeds the ${pct(tol.pricePct, 0)} tolerance (overbilled ${inr((l.unit_price - poLine.rate) * l.quantity)} across ${l.quantity} units)`);
        priceCits.push({ doc: invDoc, field: `line ${lineNo} · unit price`, value: inr(l.unit_price), against: { doc: `NetSuite ${po.tranId}`, field: `line ${poLine.line} · rate`, value: inr(poLine.rate) } });
      } else if (Math.abs(variance) > 1e-9) {
        priceNotes.push(`line ${lineNo} (${l.item_code}) ${pct(variance)} vs PO, within the ${pct(tol.pricePct, 0)} tolerance`);
      }
      const cap = received ?? 0;
      if (received !== null && l.quantity > cap + tol.overReceiptQty) {
        qtyDetails.push(`line ${lineNo} (${l.item_code}) billed ${l.quantity} units but only ${received} were received (PO ordered ${poLine.quantity}); ${l.quantity - received} units are unreceived (${inr((l.quantity - received) * l.unit_price)})`);
        qtyCits.push({ doc: invDoc, field: `line ${lineNo} · quantity`, value: String(l.quantity), against: { doc: `NetSuite ${receipts.map((r) => r.tranId).join("+")}`, field: "quantity received", value: String(received) } });
      } else if (l.quantity > poLine.quantity) {
        qtyDetails.push(`line ${lineNo} (${l.item_code}) billed ${l.quantity} units, more than the ${poLine.quantity} ordered`);
        qtyCits.push({ doc: invDoc, field: `line ${lineNo} · quantity`, value: String(l.quantity), against: { doc: `NetSuite ${po.tranId}`, field: `line ${poLine.line} · quantity`, value: String(poLine.quantity) } });
      }
    });
    checks.push(priceDetails.length
      ? { id: "price", label: "Prices match PO", status: "fail", exceptionType: "price_mismatch", rule: `Unit price may exceed PO rate by at most ${pct(tol.pricePct, 0)}`, detail: cap1(priceDetails.join("; ")) + ".", citations: priceCits }
      : { id: "price", label: "Prices match PO", status: priceNotes.length ? "warn" : "pass", detail: priceNotes.length ? cap1(priceNotes.join("; ")) + "." : "Every line is at the PO rate.", citations: [] });
    if (receipts.length) {
      checks.push(qtyDetails.length
        ? { id: "quantity", label: "Quantities received", status: "fail", exceptionType: "quantity_variance", rule: "Billed quantity may not exceed received quantity", detail: cap1(qtyDetails.join("; ")) + ".", citations: qtyCits }
        : { id: "quantity", label: "Quantities received", status: "pass", detail: "Billed quantities are covered by received quantities.", citations: [] });
    }
  }

  // 6. Arithmetic on the document itself
  const lineSum = ex.lines.reduce((s, l) => s + l.amount, 0);
  const arith: string[] = [];
  ex.lines.forEach((l, i) => { if (Math.abs(l.quantity * l.unit_price - l.amount) > tol.arithmeticAbs) arith.push(`line ${i + 1}: ${l.quantity} × ${inr(l.unit_price)} ≠ ${inr(l.amount)}`); });
  if (Math.abs(lineSum - ex.subtotal) > tol.arithmeticAbs) arith.push(`lines sum to ${inr(lineSum)}, subtotal says ${inr(ex.subtotal)}`);
  if (Math.abs(ex.subtotal + ex.tax - ex.total) > tol.arithmeticAbs) arith.push(`subtotal + tax = ${inr(ex.subtotal + ex.tax)}, total says ${inr(ex.total)}`);
  checks.push(arith.length
    ? { id: "arithmetic", label: "Invoice arithmetic", status: "fail", exceptionType: "arithmetic", rule: "Lines, subtotal, tax and total must reconcile", detail: cap1(arith.join("; ")) + ".", citations: [{ doc: invDoc, field: "totals", value: inr(ex.total) }] }
    : { id: "arithmetic", label: "Invoice arithmetic", status: "pass", detail: `Lines, GST and total reconcile to ${inr(ex.total)}.`, citations: [] });

  result.exceptions = checks.filter((c) => c.status === "fail");
  result.status = result.exceptions.length ? "exception" : "matched";
  return result;
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
