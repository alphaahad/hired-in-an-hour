import { describe, expect, it } from "vitest";
import { proposeMappings, fieldTokens } from "./mapping";

const byKey = () => Object.fromEntries(proposeMappings().map((p) => [p.source.key, p]));

describe("field mapping proposals", () => {
  it("auto-maps standard NetSuite fields to the right target", () => {
    const m = byKey();
    expect(m["vendor.custentity_gstin"]).toMatchObject({ status: "auto", best: { target: "vendor_tax_id" } });
    expect(m["vendorBill.tranId"]).toMatchObject({ status: "auto", best: { target: "invoice_number" } });
    expect(m["vendorBill.trandate"]).toMatchObject({ status: "auto", best: { target: "invoice_date" } });
    expect(m["itemReceipt.createdFrom"]).toMatchObject({ status: "auto", best: { target: "receipt_po" } });
    expect(m["purchaseOrder.item.rate"]).toMatchObject({ status: "auto", best: { target: "po_unit_price" } });
  });

  it("sends exactly the three ambiguous custom fields to a human", () => {
    const review = proposeMappings().filter((p) => p.status === "needs_review").map((p) => p.source.key).sort();
    expect(review).toEqual(["purchaseOrder.custbody_dept_code", "vendorBill.custbody_ref1", "vendorBill.custbody_svc_date"]);
  });

  it("uses referential evidence when the name says nothing", () => {
    const p = byKey()["vendorBill.custbody_ref1"];
    expect(p.best?.target).toBe("bill_po");
    expect(p.best?.signals.reference).toBe(1);
    expect(p.best?.reason).toContain("100% of values exist as purchaseOrder.tranId");
  });

  it("never lets two sources auto-claim one target", () => {
    const auto = proposeMappings().filter((p) => p.status === "auto").map((p) => p.best!.target);
    expect(new Set(auto).size).toBe(auto.length);
  });

  it("tokenises NetSuite custom field names", () => {
    expect([...fieldTokens("custbody_dept_code")]).toEqual(expect.arrayContaining(["dept", "code"]));
    expect([...fieldTokens("tranDate")]).toEqual(expect.arrayContaining(["tran", "date", "trandate"]));
  });
});
