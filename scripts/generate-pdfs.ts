// Generates the 20 synthetic invoice PDFs in public/mock-invoices.
// Three different layouts so extraction is a real problem, not a fixed template.
// Run: npm run pdfs
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { incomingInvoices, vendors } from "../src/data/seed";
import type { IncomingInvoice } from "../src/lib/types";

const OUT = join(process.cwd(), "public", "mock-invoices");
const BUYER = ["Bill to: Acme Fulfilment India Pvt Ltd (MOCK)", "Plot 14, KIADB Industrial Area", "Bengaluru 562114, Karnataka", "GSTIN 29AAACA0000A1Z0 (synthetic)"];

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string, style: "dmy" | "long" | "iso") => {
  const d = new Date(iso + "T00:00:00Z");
  if (style === "iso") return iso;
  if (style === "dmy") return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont };
const text = (c: Ctx, s: string, x: number, y: number, size = 9, b = false, color = rgb(0.1, 0.1, 0.12)) =>
  c.page.drawText(s, { x, y, size, font: b ? c.bold : c.font, color });
const right = (c: Ctx, s: string, xRight: number, y: number, size = 9, b = false) => {
  const f = b ? c.bold : c.font;
  text(c, s, xRight - f.widthOfTextAtSize(s, size), y, size, b);
};
const rule = (c: Ctx, y: number, x1 = 40, x2 = 555, t = 0.6) => c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color: rgb(0.7, 0.7, 0.72) });

function watermark(c: Ctx) {
  c.page.drawText("MOCK DATA", { x: 120, y: 300, size: 90, font: c.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.08, rotate: degrees(35) });
  text(c, "Synthetic invoice generated for a product demo. Not a real document, vendor or transaction.", 40, 24, 7, false, rgb(0.6, 0.2, 0.2));
}

function classic(c: Ctx, inv: IncomingInvoice) {
  const v = vendors.find((x) => x.companyName === inv.vendor_name)!;
  text(c, inv.vendor_name.toUpperCase(), 40, 790, 14, true);
  text(c, `${v.city}, India  |  ${v.email}`, 40, 774, 8);
  text(c, `GSTIN: ${inv.vendor_tax_id}`, 40, 762, 8);
  right(c, "TAX INVOICE", 555, 790, 16, true);
  right(c, `Invoice No: ${inv.invoice_number}`, 555, 770, 9);
  right(c, `Invoice Date: ${fmtDate(inv.invoice_date, "dmy")}`, 555, 758, 9);
  right(c, `Your PO Ref: ${inv.po_number}`, 555, 746, 9);
  rule(c, 732);
  BUYER.forEach((l, i) => text(c, l, 40, 715 - i * 12, 8.5));
  let y = 640;
  c.page.drawRectangle({ x: 40, y: y - 4, width: 515, height: 18, color: rgb(0.93, 0.93, 0.95) });
  text(c, "#", 46, y, 8.5, true); text(c, "Item", 64, y, 8.5, true); text(c, "Description", 130, y, 8.5, true);
  right(c, "Qty", 380, y, 8.5, true); right(c, "Rate (INR)", 460, y, 8.5, true); right(c, "Amount (INR)", 550, y, 8.5, true);
  y -= 22;
  inv.lines.forEach((l, i) => {
    text(c, String(i + 1), 46, y); text(c, l.item_code, 64, y); text(c, l.description, 130, y);
    right(c, String(l.quantity), 380, y); right(c, inr(l.unit_price), 460, y); right(c, inr(l.amount), 550, y);
    y -= 18;
  });
  rule(c, y + 6);
  y -= 12;
  right(c, "Taxable value", 460, y); right(c, inr(inv.subtotal), 550, y); y -= 14;
  if (inv.vendor_tax_id.startsWith("29")) {
    // intra-state supply (Karnataka -> Karnataka): CGST + SGST
    const half = Math.round((inv.tax / 2) * 100) / 100;
    right(c, "CGST @ 9%", 460, y); right(c, inr(half), 550, y); y -= 14;
    right(c, "SGST @ 9%", 460, y); right(c, inr(Math.round((inv.tax - half) * 100) / 100), 550, y); y -= 16;
  } else {
    right(c, "IGST @ 18%", 460, y); right(c, inr(inv.tax), 550, y); y -= 16;
  }
  right(c, "Invoice Total (INR)", 460, y, 10, true); right(c, inr(inv.total), 550, y, 10, true);
  text(c, `Payment terms: ${v.terms}. Please quote the invoice number with remittance.`, 40, 120, 8);
}

function modern(c: Ctx, inv: IncomingInvoice) {
  const v = vendors.find((x) => x.companyName === inv.vendor_name)!;
  c.page.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(0.13, 0.2, 0.3) });
  text(c, inv.vendor_name, 40, 805, 15, true, rgb(1, 1, 1));
  text(c, `${v.city}  ·  GST Reg. ${inv.vendor_tax_id}`, 40, 788, 8.5, false, rgb(0.85, 0.88, 0.92));
  text(c, "INVOICE", 470, 805, 15, true, rgb(1, 1, 1));
  const meta: [string, string][] = [["Invoice #", inv.invoice_number], ["Issued", fmtDate(inv.invoice_date, "long")], ["Purchase order", inv.po_number], ["Currency", "INR"]];
  meta.forEach(([k, val], i) => { text(c, k, 360, 730 - i * 14, 8, false, rgb(0.4, 0.4, 0.45)); text(c, val, 450, 730 - i * 14, 9, true); });
  text(c, "Billed to", 40, 730, 8, false, rgb(0.4, 0.4, 0.45));
  BUYER.forEach((l, i) => text(c, l.replace("Bill to: ", ""), 40, 716 - i * 12, 8.5));
  let y = 640;
  text(c, "DESCRIPTION", 40, y, 7.5, true); text(c, "SKU", 260, y, 7.5, true);
  right(c, "UNITS", 380, y, 7.5, true); right(c, "UNIT PRICE", 465, y, 7.5, true); right(c, "LINE TOTAL", 555, y, 7.5, true);
  rule(c, y - 6, 40, 555, 1);
  y -= 22;
  inv.lines.forEach((l) => {
    text(c, l.description, 40, y); text(c, l.item_code, 260, y);
    right(c, l.quantity.toLocaleString("en-IN"), 380, y); right(c, `Rs. ${inr(l.unit_price)}`, 465, y); right(c, `Rs. ${inr(l.amount)}`, 555, y);
    y -= 20;
  });
  y -= 10;
  const rows: [string, string, boolean][] = [["Subtotal", inr(inv.subtotal), false], ["GST (18%)", inr(inv.tax), false], ["Amount due", `Rs. ${inr(inv.total)}`, true]];
  rows.forEach(([k, val, b]) => { right(c, k, 465, y, b ? 10 : 9, b); right(c, val, 555, y, b ? 10 : 9, b); y -= 16; });
  text(c, `Due within ${v.terms.replace("Net ", "")} days of the issue date.`, 40, 120, 8);
}

function compact(c: Ctx, inv: IncomingInvoice) {
  const v = vendors.find((x) => x.companyName === inv.vendor_name)!;
  text(c, `${inv.vendor_name}  —  ${v.city}`, 40, 800, 11, true);
  text(c, `GSTIN ${inv.vendor_tax_id}   ·   ${v.email}`, 40, 786, 8);
  rule(c, 776);
  text(c, `Bill No. ${inv.invoice_number}`, 40, 758, 10, true);
  text(c, `Dated ${fmtDate(inv.invoice_date, "iso")}`, 220, 758, 9);
  text(c, `Against P.O. ${inv.po_number}`, 380, 758, 9);
  text(c, BUYER.join("  ·  "), 40, 740, 7);
  let y = 712;
  text(c, "Qty x Item @ Rate = Amount", 40, y, 8, true);
  y -= 16;
  inv.lines.forEach((l) => {
    text(c, `${l.quantity} x ${l.item_code} (${l.description}) @ ${inr(l.unit_price)}`, 40, y, 8.5);
    right(c, inr(l.amount), 555, y, 8.5);
    y -= 15;
  });
  rule(c, y + 5);
  y -= 10;
  right(c, `Net ${inr(inv.subtotal)}   +   GST 18% ${inr(inv.tax)}   =   Total INR ${inr(inv.total)}`, 555, y, 9.5, true);
  text(c, `Terms: ${v.terms}`, 40, 120, 8);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const inv of incomingInvoices) {
    const doc = await PDFDocument.create();
    doc.setTitle(`MOCK invoice ${inv.invoice_number}`);
    doc.setProducer("Zamp in an Hour demo (synthetic data)");
    const page = doc.addPage([595, 842]);
    const c: Ctx = { page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
    ({ classic, modern, compact })[inv.layout](c, inv);
    watermark(c);
    writeFileSync(join(OUT, `${inv.id}.pdf`), await doc.save({ useObjectStreams: false }));
  }
  console.log(`Wrote ${incomingInvoices.length} PDFs to ${OUT}`);
  console.table(incomingInvoices.map((i) => ({ id: i.id, vendor: i.vendor_name.split(" ")[0], number: i.invoice_number, po: i.po_number, total: i.total, scenario: i.scenario })));
}

main();
