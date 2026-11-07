// Deterministic synthetic dataset — MOCK DATA. No real companies, people or Zamp data.
// The same function feeds the mock NetSuite API, the PDF generator and the tests.
import type { IncomingInvoice, ItemReceipt, PurchaseOrder, Vendor, VendorBill, Item, InvoiceLine } from "@/lib/types";

export const GST_RATE = 0.18;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const vendors: Vendor[] = [
  { id: "V-101", entityId: "KAVERI-CORR", companyName: "Kaveri Corrugates Pvt Ltd", custentity_gstin: "29AAKCK4821M1Z3", terms: "Net 30", city: "Bengaluru", email: "ar@kaveri-corrugates.example" },
  { id: "V-102", entityId: "HALDEN-SAFE", companyName: "Haldenwerk Safety Supplies Pvt Ltd", custentity_gstin: "27AAFCH7310K1Z8", terms: "Net 45", city: "Pune", email: "billing@haldenwerk.example" },
  { id: "V-103", entityId: "SUTLEJ-ELEC", companyName: "Sutlej Electricals Pvt Ltd", custentity_gstin: "03AAGCS2294P1Z1", terms: "Net 30", city: "Ludhiana", email: "accounts@sutlej-elec.example" },
  { id: "V-104", entityId: "MERIDIAN-IT", companyName: "Meridian Desk & IT Pvt Ltd", custentity_gstin: "27AAJCM5503D1Z6", terms: "Net 15", city: "Mumbai", email: "invoices@meridian-desk.example" },
  { id: "V-105", entityId: "TANAGER-LAB", companyName: "Tanager Lab Consumables Pvt Ltd", custentity_gstin: "36AAHCT9087L1Z2", terms: "Net 30", city: "Hyderabad", email: "finance@tanager-lab.example" },
];

export const items: Item[] = [
  { code: "KC-BOX-S", description: "Corrugated carton, small (3-ply)", vendorId: "V-101", rate: 18.5 },
  { code: "KC-BOX-L", description: "Corrugated carton, large (5-ply)", vendorId: "V-101", rate: 42 },
  { code: "KC-TAPE", description: "BOPP packing tape, 48mm x 65m", vendorId: "V-101", rate: 65 },
  { code: "HS-GLV", description: "Nitrile gloves, box of 100", vendorId: "V-102", rate: 420 },
  { code: "HS-HLM", description: "Safety helmet, ISI marked", vendorId: "V-102", rate: 1000 },
  { code: "HS-VST", description: "Hi-vis reflective vest", vendorId: "V-102", rate: 260 },
  { code: "SE-CBL", description: "Copper cable 2.5 sq mm, 25 m coil", vendorId: "V-103", rate: 1850 },
  { code: "SE-MCB", description: "MCB 32A double pole", vendorId: "V-103", rate: 540 },
  { code: "SE-LED", description: "LED panel 2x2 ft, 36W", vendorId: "V-103", rate: 1290 },
  { code: "MD-KB", description: "Wired keyboard, full size", vendorId: "V-104", rate: 890 },
  { code: "MD-MON", description: "24-inch IPS monitor", vendorId: "V-104", rate: 11400 },
  { code: "MD-DOCK", description: "USB-C docking station", vendorId: "V-104", rate: 6750 },
  { code: "TL-PIP", description: "Pipette tips 200 uL, rack of 960", vendorId: "V-105", rate: 1340 },
  { code: "TL-VIAL", description: "Glass sample vials 2 mL, pack of 100", vendorId: "V-105", rate: 2200 },
  { code: "TL-ETH", description: "Ethanol absolute, 5 L", vendorId: "V-105", rate: 3150 },
];

const vendorMeta: Record<string, { gl: string; dept: string; layout: IncomingInvoice["layout"]; invNo: (n: number) => string }> = {
  "V-101": { gl: "5100", dept: "CC-WH-150", layout: "classic", invNo: (n) => `KC/26-27/0${n}` },
  "V-102": { gl: "5200", dept: "CC-FAC-120", layout: "modern", invNo: (n) => `HSS-INV-${n}` },
  "V-103": { gl: "5300", dept: "CC-FAC-120", layout: "compact", invNo: (n) => `SE2026-${n}` },
  "V-104": { gl: "6100", dept: "CC-IT-130", layout: "modern", invNo: (n) => `MDI-${String(n).padStart(4, "0")}` },
  "V-105": { gl: "5400", dept: "CC-LAB-140", layout: "classic", invNo: (n) => `TLC-26-0${n}` },
};

export const glAccounts: Record<string, string> = {
  "5100": "Packaging Materials",
  "5200": "Safety & PPE",
  "5300": "Electrical Maintenance",
  "5400": "Lab Consumables",
  "6100": "IT Equipment",
};

const rateOf = (code: string) => items.find((i) => i.code === code)!.rate;
const descOf = (code: string) => items.find((i) => i.code === code)!.description;

type Spec = {
  vendor: string;
  invNo: number;
  invDate: string;
  poDate: string;
  grnDate: string | null; // null = goods never received (missing receipt)
  lines: [code: string, qty: number][];
  priceOverride?: Record<string, number>; // invoice price differs from PO
  receivedOverride?: Record<string, number>; // receipt qty differs from billed
  scenario: IncomingInvoice["scenario"];
};

// 19 new purchase orders, each billed by one incoming invoice. The 20th invoice is a
// re-submission of a bill already paid last quarter (the duplicate scenario).
const specs: Spec[] = [
  { vendor: "V-101", invNo: 412, invDate: "2026-10-03", poDate: "2026-09-18", grnDate: "2026-09-29", lines: [["KC-BOX-S", 2000], ["KC-TAPE", 120]], scenario: "clean" },
  { vendor: "V-102", invNo: 3381, invDate: "2026-10-04", poDate: "2026-09-20", grnDate: "2026-09-30", lines: [["HS-GLV", 40], ["HS-VST", 60]], scenario: "clean" },
  { vendor: "V-103", invNo: 141, invDate: "2026-10-05", poDate: "2026-09-21", grnDate: "2026-10-01", lines: [["SE-CBL", 12], ["SE-MCB", 30]], scenario: "clean" },
  { vendor: "V-104", invNo: 57, invDate: "2026-10-06", poDate: "2026-09-22", grnDate: "2026-10-02", lines: [["MD-MON", 8], ["MD-KB", 8]], scenario: "clean" },
  { vendor: "V-105", invNo: 233, invDate: "2026-10-07", poDate: "2026-09-23", grnDate: "2026-10-03", lines: [["TL-VIAL", 15], ["TL-ETH", 6]], scenario: "clean" },
  { vendor: "V-102", invNo: 3392, invDate: "2026-10-08", poDate: "2026-09-24", grnDate: "2026-10-03", lines: [["HS-HLM", 50], ["HS-GLV", 20]], priceOverride: { "HS-HLM": 1060 }, scenario: "price_mismatch" },
  { vendor: "V-101", invNo: 419, invDate: "2026-10-09", poDate: "2026-09-25", grnDate: "2026-10-05", lines: [["KC-BOX-L", 800], ["KC-BOX-S", 1500]], scenario: "clean" },
  { vendor: "V-103", invNo: 148, invDate: "2026-10-10", poDate: "2026-09-26", grnDate: "2026-10-06", lines: [["SE-LED", 40]], scenario: "clean" },
  // within tolerance: +1.2% on a cable coil — should pass with a note, not raise an exception
  { vendor: "V-103", invNo: 152, invDate: "2026-10-12", poDate: "2026-09-28", grnDate: "2026-10-08", lines: [["SE-CBL", 10], ["SE-LED", 12]], priceOverride: { "SE-CBL": 1872.2 }, scenario: "clean" },
  { vendor: "V-104", invNo: 63, invDate: "2026-10-12", poDate: "2026-09-29", grnDate: "2026-10-08", lines: [["MD-DOCK", 10]], scenario: "clean" },
  { vendor: "V-103", invNo: 157, invDate: "2026-10-13", poDate: "2026-09-30", grnDate: null, lines: [["SE-MCB", 60], ["SE-CBL", 6]], scenario: "missing_receipt" },
  { vendor: "V-105", invNo: 241, invDate: "2026-10-14", poDate: "2026-10-01", grnDate: "2026-10-09", lines: [["TL-PIP", 30]], scenario: "clean" },
  { vendor: "V-101", invNo: 427, invDate: "2026-10-15", poDate: "2026-10-02", grnDate: "2026-10-10", lines: [["KC-TAPE", 300]], scenario: "clean" },
  { vendor: "V-102", invNo: 3405, invDate: "2026-10-16", poDate: "2026-10-03", grnDate: "2026-10-11", lines: [["HS-VST", 100], ["HS-HLM", 20]], scenario: "clean" },
  { vendor: "V-104", invNo: 71, invDate: "2026-10-17", poDate: "2026-10-05", grnDate: "2026-10-13", lines: [["MD-KB", 25], ["MD-DOCK", 4]], scenario: "clean" },
  { vendor: "V-101", invNo: 433, invDate: "2026-10-19", poDate: "2026-10-06", grnDate: "2026-10-14", lines: [["KC-BOX-L", 500]], scenario: "clean" },
  // slot 17 = duplicate, inserted below
  { vendor: "V-102", invNo: 3417, invDate: "2026-10-21", poDate: "2026-10-08", grnDate: "2026-10-16", lines: [["HS-GLV", 60]], scenario: "clean" },
  { vendor: "V-105", invNo: 256, invDate: "2026-10-22", poDate: "2026-10-09", grnDate: "2026-10-17", lines: [["TL-PIP", 120]], receivedOverride: { "TL-PIP": 100 }, scenario: "quantity_variance" },
  { vendor: "V-105", invNo: 262, invDate: "2026-10-23", poDate: "2026-10-10", grnDate: "2026-10-18", lines: [["TL-ETH", 10], ["TL-VIAL", 8]], scenario: "clean" },
];

// Historical, already-paid bills from last quarter (needed for duplicate detection).
const historicalSpecs: { vendor: string; invNo: number; date: string; lines: [string, number][]; blankGl?: boolean }[] = [
  { vendor: "V-101", invNo: 371, date: "2026-07-08", lines: [["KC-BOX-S", 1800]] },
  { vendor: "V-102", invNo: 3290, date: "2026-07-12", lines: [["HS-GLV", 30]] },
  { vendor: "V-103", invNo: 118, date: "2026-07-19", lines: [["SE-LED", 25]], blankGl: true },
  { vendor: "V-104", invNo: 42, date: "2026-07-24", lines: [["MD-MON", 4], ["MD-DOCK", 4]] },
  { vendor: "V-105", invNo: 198, date: "2026-07-30", lines: [["TL-PIP", 20]] },
  { vendor: "V-101", invNo: 384, date: "2026-08-06", lines: [["KC-TAPE", 200]] },
  { vendor: "V-102", invNo: 3318, date: "2026-08-14", lines: [["HS-VST", 80]] },
  { vendor: "V-103", invNo: 126, date: "2026-08-21", lines: [["SE-MCB", 40]] },
  { vendor: "V-104", invNo: 49, date: "2026-08-28", lines: [["MD-KB", 30]], blankGl: true },
  { vendor: "V-105", invNo: 211, date: "2026-09-04", lines: [["TL-ETH", 8]] },
  { vendor: "V-101", invNo: 398, date: "2026-09-10", lines: [["KC-BOX-L", 600]] },
  { vendor: "V-102", invNo: 3346, date: "2026-09-16", lines: [["HS-HLM", 30]] },
];

const addDays = (iso: string, d: number) => {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const termsDays = (vendorId: string) => parseInt(vendors.find((v) => v.id === vendorId)!.terms.replace(/\D/g, ""), 10);

function build() {
  const purchaseOrders: PurchaseOrder[] = [];
  const receipts: ItemReceipt[] = [];
  const bills: VendorBill[] = [];
  const invoices: IncomingInvoice[] = [];

  // Historical POs (PO-2201..), receipts (GRN-5401..), paid bills (VB-8801..)
  historicalSpecs.forEach((h, i) => {
    const meta = vendorMeta[h.vendor];
    const poId = `PO-${2201 + i}`;
    const poDate = addDays(h.date, -14);
    purchaseOrders.push({
      id: `po-h${i + 1}`, tranId: poId, entity: h.vendor, tranDate: poDate, custbody_dept_code: meta.dept, account: meta.gl, currency: "INR",
      item: h.lines.map(([code, qty], l) => ({ line: l + 1, item: code, description: descOf(code), quantity: qty, rate: rateOf(code) })),
    });
    receipts.push({
      id: `grn-h${i + 1}`, tranId: `GRN-${5401 + i}`, createdFrom: poId, entity: h.vendor, tranDate: addDays(h.date, -4),
      item: h.lines.map(([code, qty], l) => ({ line: l + 1, item: code, quantity: qty })),
    });
    const sub = round2(h.lines.reduce((s, [code, qty]) => s + qty * rateOf(code), 0));
    bills.push({
      id: `vb-h${i + 1}`, tranId: meta.invNo(h.invNo), entity: h.vendor, trandate: h.date, duedate: addDays(h.date, termsDays(h.vendor)),
      custbody_ref1: poId, custbody_svc_date: addDays(h.date, -4), account: h.blankGl ? "" : meta.gl,
      usertotal: round2(sub * (1 + GST_RATE)), currency: "INR", status: "paidInFull",
    });
  });

  // New POs (PO-2301..), receipts (GRN-5501..), incoming invoices
  let grnSeq = 5501;
  specs.forEach((s, i) => {
    const meta = vendorMeta[s.vendor];
    const poId = `PO-${2301 + i}`;
    purchaseOrders.push({
      id: `po-${i + 1}`, tranId: poId, entity: s.vendor, tranDate: s.poDate, custbody_dept_code: meta.dept, account: meta.gl, currency: "INR",
      item: s.lines.map(([code, qty], l) => ({ line: l + 1, item: code, description: descOf(code), quantity: qty, rate: rateOf(code) })),
    });
    if (s.grnDate) {
      receipts.push({
        id: `grn-${i + 1}`, tranId: `GRN-${grnSeq++}`, createdFrom: poId, entity: s.vendor, tranDate: s.grnDate,
        item: s.lines.map(([code, qty], l) => ({ line: l + 1, item: code, quantity: s.receivedOverride?.[code] ?? qty })),
      });
    }
    const lines: InvoiceLine[] = s.lines.map(([code, qty]) => {
      const price = s.priceOverride?.[code] ?? rateOf(code);
      return { item_code: code, description: descOf(code), quantity: qty, unit_price: price, amount: round2(qty * price) };
    });
    invoices.push(makeInvoice(s.vendor, meta.invNo(s.invNo), s.invDate, poId, lines, s.scenario, meta.layout));
  });

  // The duplicate: Meridian re-sends historical bill MDI-0042 as "MDI42" with a new date.
  const histIdx = historicalSpecs.findIndex((h) => h.vendor === "V-104" && h.invNo === 42);
  const h = historicalSpecs[histIdx];
  const dupLines: InvoiceLine[] = h.lines.map(([code, qty]) => ({ item_code: code, description: descOf(code), quantity: qty, unit_price: rateOf(code), amount: round2(qty * rateOf(code)) }));
  invoices.splice(16, 0, makeInvoice("V-104", "MDI42", "2026-10-20", `PO-${2201 + histIdx}`, dupLines, "duplicate", "compact"));

  invoices.forEach((inv, i) => {
    inv.id = `inv-${String(i + 1).padStart(2, "0")}`;
    inv.file = `/mock-invoices/${inv.id}.pdf`;
  });

  return { purchaseOrders, receipts, bills, invoices };
}

function makeInvoice(vendorId: string, number: string, date: string, po: string, lines: InvoiceLine[], scenario: IncomingInvoice["scenario"], layout: IncomingInvoice["layout"]): IncomingInvoice {
  const v = vendors.find((x) => x.id === vendorId)!;
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2(subtotal * GST_RATE);
  return {
    id: "", file: "", layout, vendor_name: v.companyName, vendor_tax_id: v.custentity_gstin, invoice_number: number, invoice_date: date,
    po_number: po, currency: "INR", lines, subtotal, tax, total: round2(subtotal + tax), scenario,
  };
}

const data = build();
export const purchaseOrders = data.purchaseOrders;
export const itemReceipts = data.receipts;
export const vendorBills = data.bills;
export const incomingInvoices = data.invoices;
