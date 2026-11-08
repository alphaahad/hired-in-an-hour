import { describe, expect, it } from "vitest";
import { draftVendorQuery, feedFromActions, initials, liveSteps, personaColour, type ActionLike } from "./narrate";
import { threeWayMatch, type MatchContext } from "./match";
import { incomingInvoices, itemReceipts, purchaseOrders, vendorBills, vendors } from "@/data/seed";
import type { Extraction, IncomingInvoice } from "./types";

const ctx: MatchContext = { vendors, purchaseOrders, receipts: itemReceipts, bills: vendorBills, priorInvoices: [] };
const withEvidence = (inv: IncomingInvoice): Extraction => ({
  ...inv,
  evidence: { invoice_number: inv.invoice_number, po_number: inv.po_number, vendor_tax_id: inv.vendor_tax_id, total: inv.total.toLocaleString("en-IN", { minimumFractionDigits: 2 }) },
});
const scenario = (s: IncomingInvoice["scenario"]) => incomingInvoices.find((i) => i.scenario === s)!;

describe("persona", () => {
  it("makes initials from one or more names", () => {
    expect(initials("Meera")).toBe("M");
    expect(initials("asha  rao")).toBe("AR");
  });
  it("gives the same name the same colour", () => {
    expect(personaColour("Meera")).toEqual(personaColour("meera"));
  });
});

describe("liveSteps", () => {
  it("narrates the price mismatch and stops, highlighting the overbilled price", () => {
    const inv = scenario("price_mismatch");
    const ex = withEvidence(inv);
    const steps = liveSteps("inv-06.pdf", ex, threeWayMatch(inv.id, ex, ctx), { source: "cached", ms: 300 });
    expect(steps[0].text).toContain("HSS-INV-3392");
    expect(steps[0].text).toContain("Gemini · cached");
    const price = steps.find((s) => s.status === "fail")!;
    expect(price.text).toContain("₹1,060.00");
    expect(price.highlight).toContain("1060.00");
    expect(steps.at(-1)!.text).toMatch(/Stopping here/);
  });
  it("ends a clean invoice by asking before posting", () => {
    const inv = scenario("clean");
    const ex = withEvidence(inv);
    const steps = liveSteps("inv-01.pdf", ex, threeWayMatch(inv.id, ex, ctx), { source: "live", ms: 6200 });
    expect(steps.every((s) => s.status !== "fail")).toBe(true);
    expect(steps.at(-1)!.text).toMatch(/ask you before posting/);
  });
});

describe("draftVendorQuery", () => {
  it("cites the evidence and asks for a credit note on a price mismatch", () => {
    const inv = scenario("price_mismatch");
    const ex = withEvidence(inv);
    const d = draftVendorQuery("Meera", inv.vendor_name, ex, threeWayMatch(inv.id, ex, ctx));
    expect(d.subject).toContain("HSS-INV-3392");
    expect(d.body).toContain("₹1,060.00");
    expect(d.body).toMatch(/credit note/);
    expect(d.body).toMatch(/Meera\nAP Specialist/);
  });
  it("asks for proof of delivery when there is no receipt", () => {
    const inv = scenario("missing_receipt");
    const ex = withEvidence(inv);
    expect(draftVendorQuery("Meera", inv.vendor_name, ex, threeWayMatch(inv.id, ex, ctx)).body).toMatch(/proof of delivery/);
  });
});

describe("feedFromActions", () => {
  const act = (id: string, ts: string, type: string, extra: Partial<ActionLike> = {}): ActionLike =>
    ({ id, ts, actor: "agent", type, target: "", summary: "", evidence: null, before: null, after: null, ...extra });
  const base = {
    name: "Meera",
    hiredAt: "2026-11-08T10:00:00Z",
    invoice: (id: string) => (id === "inv-01" ? { id, vendor: "Kaveri Corrugates Pvt Ltd", number: "KC/26-27/0412", total: 52864, poId: "PO-2301", receiptIds: ["GRN-5501"] } : undefined),
    mapping: { auto: 19, total: 22, review: 3 },
  };

  it("introduces the employee, then narrates setup in order", () => {
    const lines = feedFromActions([
      act("a2", "2026-11-08T10:00:20Z", "mapping_decision", { actor: "human", summary: "Approved vendorBill.custbody_ref1 → Bill → PO link" }),
      act("a1", "2026-11-08T10:00:05Z", "erp_connected", { after: { accountId: "TSTDRV2026417", counts: { vendor: 5, purchaseOrder: 31, itemReceipt: 30, vendorBill: 12 } } }),
    ], base);
    expect(lines[0].text).toMatch(/^Hi, I'm Meera/);
    expect(lines[1].text).toContain("31 purchase orders");
    expect(lines[2].text).toContain("19 of 22");
    expect(lines[3]).toMatchObject({ who: "you", text: "Confirmed: custbody_ref1 is the Bill → PO link." });
  });

  it("celebrates only the first posted bill, with the time since hire", () => {
    const lines = feedFromActions([
      act("p1", "2026-11-08T10:04:12Z", "bill_posted", { target: "invoice:inv-01", after: { bill_id: "VB-9001" }, evidence: { decision: "approve" } }),
      act("p2", "2026-11-08T10:05:00Z", "bill_posted", { target: "invoice:inv-01", after: { bill_id: "VB-9002" }, evidence: { decision: "approve" } }),
    ], base);
    const posted = lines.filter((l) => l.text.startsWith("Posted"));
    expect(posted[0]).toMatchObject({ tone: "celebrate" });
    expect(posted[0].text).toContain("4m 12s");
    expect(posted[1].tone).toBe("ok");
  });

  it("keeps acronyms when explaining quarantined records", () => {
    const lines = feedFromActions([
      act("s1", "2026-11-08T10:01:00Z", "sync_run", { after: { total: 78, ok: 76, failed: 2, failures: [{ type: "vendorBill", id: "SE2026-118", error: "GL account is empty" }, { type: "vendorBill", id: "MDI-0049", error: "GL account is empty" }] } }),
    ], base);
    expect(lines.find((l) => l.text.startsWith("Test sync"))!.text).toContain("GL account is empty");
  });
});
