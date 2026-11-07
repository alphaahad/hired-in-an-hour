// Domain types. Shapes for the mock NetSuite records loosely follow NetSuite's
// public record names (vendor, purchaseOrder, itemReceipt, vendorBill).
// All data in this project is synthetic MOCK DATA.

export type Vendor = {
  id: string; // internalId, e.g. "V-101"
  entityId: string;
  companyName: string;
  custentity_gstin: string;
  terms: string; // "Net 30"
  city: string;
  email: string;
};

export type Item = {
  code: string;
  description: string;
  vendorId: string;
  rate: number; // agreed unit price on PO (INR)
};

export type POLine = { line: number; item: string; description: string; quantity: number; rate: number };

export type PurchaseOrder = {
  id: string;
  tranId: string; // "PO-2231"
  entity: string; // vendor id
  tranDate: string;
  custbody_dept_code: string; // cost center (ambiguous vs GL account)
  account: string; // GL account
  currency: "INR";
  item: POLine[];
};

export type ReceiptLine = { line: number; item: string; quantity: number };

export type ItemReceipt = {
  id: string;
  tranId: string; // "GRN-5501"
  createdFrom: string; // PO tranId
  entity: string;
  tranDate: string;
  item: ReceiptLine[];
};

export type VendorBill = {
  id: string;
  tranId: string; // vendor's invoice number as recorded
  entity: string;
  trandate: string;
  duedate: string;
  custbody_ref1: string; // holds the PO number (deliberately vague name)
  custbody_svc_date: string; // service/delivery date (ambiguous with trandate)
  account: string; // GL account; may be blank (validation failure)
  usertotal: number;
  currency: "INR";
  status: "paidInFull" | "open" | "pendingApproval";
};

export type InvoiceLine = { item_code: string; description: string; quantity: number; unit_price: number; amount: number };

/** Ground truth of an incoming invoice PDF (what a perfect extractor would read). */
export type IncomingInvoice = {
  id: string; // file id, "inv-01"
  file: string; // /mock-invoices/inv-01.pdf
  layout: "classic" | "modern" | "compact";
  vendor_name: string;
  vendor_tax_id: string;
  invoice_number: string;
  invoice_date: string;
  po_number: string;
  currency: "INR";
  lines: InvoiceLine[];
  subtotal: number;
  tax: number; // 18% GST
  total: number;
  /** The scenario we planted (for tests and docs only; the agent never sees this). */
  scenario: "clean" | "price_mismatch" | "missing_receipt" | "duplicate" | "quantity_variance";
};

/** Fields the agent extracts from a PDF, each with the text snippet it read it from. */
export type Extraction = {
  vendor_name: string;
  vendor_tax_id: string;
  invoice_number: string;
  invoice_date: string;
  po_number: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  evidence: Record<string, string>; // field -> quoted source text
};

export type Citation = {
  doc: string; // "Invoice HSS-INV-3381"
  field: string; // "line 2 · unit price"
  value: string;
  against?: { doc: string; field: string; value: string };
};

export type CheckResult = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
  rule?: string;
  citations: Citation[];
  exceptionType?: ExceptionType;
};

export type ExceptionType = "price_mismatch" | "missing_receipt" | "duplicate" | "quantity_variance" | "unknown_vendor" | "unknown_po" | "arithmetic";

export type MatchResult = {
  status: "matched" | "exception";
  vendorId: string | null;
  poId: string | null;
  receiptIds: string[];
  checks: CheckResult[];
  exceptions: CheckResult[];
  lineTable: {
    line: number;
    item: string;
    invoice: { qty: number; price: number };
    po: { qty: number; price: number } | null;
    received: number | null;
  }[];
};
