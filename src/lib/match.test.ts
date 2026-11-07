import { describe, expect, it } from "vitest";
import { normalizeInvoiceNumber, threeWayMatch, type MatchContext } from "./match";
import { incomingInvoices, itemReceipts, purchaseOrders, vendorBills, vendors } from "@/data/seed";
import type { Extraction, IncomingInvoice } from "./types";

const perfect = (inv: IncomingInvoice): Extraction => ({ ...inv, evidence: {} });
const ctx: MatchContext = { vendors, purchaseOrders, receipts: itemReceipts, bills: vendorBills, priorInvoices: [] };

describe("normalizeInvoiceNumber", () => {
  it("treats re-keyed numbers as the same", () => {
    expect(normalizeInvoiceNumber("MDI-0042")).toBe(normalizeInvoiceNumber("MDI42"));
    expect(normalizeInvoiceNumber("mdi 0042")).toBe("MDI42");
  });
  it("keeps zeros that are part of the number", () => {
    expect(normalizeInvoiceNumber("SE2026-141")).toBe("SE2026141");
    expect(normalizeInvoiceNumber("KC/26-27/0412")).not.toBe(normalizeInvoiceNumber("KC/26-27/412X"));
  });
});

describe("threeWayMatch on the seeded dataset", () => {
  for (const inv of incomingInvoices) {
    it(`${inv.id} (${inv.scenario})`, () => {
      const r = threeWayMatch(inv.id, perfect(inv), ctx);
      if (inv.scenario === "clean") {
        expect(r.status, JSON.stringify(r.exceptions, null, 1)).toBe("matched");
      } else {
        expect(r.status).toBe("exception");
        expect(r.exceptions.map((e) => e.exceptionType)).toEqual([inv.scenario]);
        expect(r.exceptions[0].citations.length).toBeGreaterThan(0);
      }
    });
  }

  it("exactly 16 clean and 4 exceptions", () => {
    const results = incomingInvoices.map((i) => threeWayMatch(i.id, perfect(i), ctx));
    expect(results.filter((r) => r.status === "matched")).toHaveLength(16);
  });

  it("cites the exact line, value and PO rate for the price mismatch", () => {
    const inv = incomingInvoices.find((i) => i.scenario === "price_mismatch")!;
    const ex = threeWayMatch(inv.id, perfect(inv), ctx).exceptions[0];
    expect(ex.detail).toContain("₹1,060.00");
    expect(ex.detail).toContain("₹1,000.00");
    expect(ex.detail).toContain("+6.0%");
    expect(ex.citations[0]).toMatchObject({ field: "line 1 · unit price", against: { value: "₹1,000.00" } });
  });

  it("passes a +1.2% variance with a warning, not an exception", () => {
    const inv = incomingInvoices.find((i) => i.lines.some((l) => l.unit_price === 1872.2))!;
    const r = threeWayMatch(inv.id, perfect(inv), ctx);
    expect(r.status).toBe("matched");
    expect(r.checks.find((c) => c.id === "price")?.status).toBe("warn");
  });

  it("flags an in-batch duplicate even when the ERP has no bill yet", () => {
    const inv = incomingInvoices[0];
    const r = threeWayMatch("inv-99", { ...perfect(inv), invoice_number: inv.invoice_number.replace("/0", "/") }, {
      ...ctx,
      priorInvoices: [{ invoiceId: inv.id, vendorId: "V-101", invoice_number: inv.invoice_number, total: inv.total, date: inv.invoice_date }],
    });
    // "KC/26-27/0412" vs "KC/26-27/412" are different strings but the same normalised number
    expect(r.exceptions.map((e) => e.exceptionType)).toContain("duplicate");
  });

  it("catches an extraction error through arithmetic", () => {
    const inv = incomingInvoices[0];
    const r = threeWayMatch(inv.id, { ...perfect(inv), total: inv.total + 900 }, ctx);
    expect(r.exceptions.map((e) => e.exceptionType)).toContain("arithmetic");
  });

  it("falls back to vendor name when GSTIN is misread", () => {
    const inv = incomingInvoices[0];
    const r = threeWayMatch(inv.id, { ...perfect(inv), vendor_tax_id: "29AAKCK4821M1Z8" }, ctx);
    expect(r.vendorId).toBe("V-101");
    expect(r.checks.find((c) => c.id === "vendor")?.status).toBe("warn");
  });
});
