// Gemini calls with three honest outcomes, always shown in the UI:
//   live     — called the model just now
//   cached   — identical input was sent to the model before; reusing that answer
//   fallback — no key / rate-limited / model error: precomputed answer, clearly labelled
import "server-only";

/** Strips the API key (and anything key-shaped) from text that may reach logs, the DB or the browser. */
export function redactSecrets(text: string): string {
  let out = text;
  const key = process.env.GEMINI_API_KEY;
  if (key) out = out.split(key).join("[redacted]");
  return out
    .replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
}
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { q, q1, json } from "./db";
import type { Extraction, IncomingInvoice } from "./types";
import { targets, IGNORE, type SourceField, type Candidate } from "./mapping";

export type LlmSource = "live" | "cached" | "fallback";
export type LlmResult<T> = { value: T; source: LlmSource; model: string; note?: string; ms?: number };

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const PROMPT_VERSION = "v1";
const PER_WORKSPACE_PER_HOUR = 80;
const GLOBAL_PER_DAY = 3000;

async function allow(ws: string) {
  const now = Date.now();
  for (const [key, windowMs, limit] of [[`ws:${ws}`, 3600_000, PER_WORKSPACE_PER_HOUR], ["global", 86400_000, GLOBAL_PER_DAY]] as const) {
    const row = await q1<{ window_start: string; count: number }>("select window_start, count from rate_limits where key = $1", [key]);
    if (!row || now - new Date(row.window_start).getTime() > windowMs) {
      await q("insert into rate_limits (key, window_start, count) values ($1, now(), 1) on conflict (key) do update set window_start = now(), count = 1", [key]);
    } else if (row.count >= limit) {
      return false;
    } else {
      await q("update rate_limits set count = count + 1 where key = $1", [key]);
    }
  }
  return true;
}

async function callGemini(parts: unknown[], schema: object): Promise<unknown> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: parts as never }],
    config: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 },
  });
  if (!res.text) throw new Error("Empty model response");
  return JSON.parse(res.text);
}

async function cachedCall<T>(opts: {
  ws: string;
  key: string;
  forceLive?: boolean;
  run: () => Promise<unknown>;
  parse: (raw: unknown) => T;
  fallback: () => T;
}): Promise<LlmResult<T>> {
  const cacheKey = createHash("sha256").update(`${PROMPT_VERSION}|${MODEL}|${opts.key}`).digest("hex");
  if (!opts.forceLive) {
    const hit = await q1<{ value: unknown }>("select value from llm_cache where key = $1", [cacheKey]);
    if (hit) {
      try { return { value: opts.parse(hit.value), source: "cached", model: MODEL }; } catch { /* stale shape: fall through */ }
    }
  }
  if (!process.env.GEMINI_API_KEY) return { value: opts.fallback(), source: "fallback", model: MODEL, note: "No GEMINI_API_KEY configured" };
  if (!(await allow(opts.ws))) return { value: opts.fallback(), source: "fallback", model: MODEL, note: "Rate limit reached for this demo" };
  const t0 = Date.now();
  try {
    const raw = await withRateLimitRetry(opts.run);
    const value = opts.parse(raw);
    await q("insert into llm_cache (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, created_at = now()", [cacheKey, json(raw)]);
    return { value, source: "live", model: MODEL, ms: Date.now() - t0 };
  } catch (e) {
    // Never log the raw error object (it can carry request config); log and return a redacted message only.
    const msg = redactSecrets(String((e as Error)?.message ?? e));
    console.error("Gemini call failed:", msg);
    const note = isRateLimit(msg) ? "Gemini is rate-limiting this demo's key right now" : isOverloaded(msg) ? "Gemini is overloaded right now (Google-side, temporary)" : `Model call failed: ${msg.slice(0, 120)}`;
    return { value: opts.fallback(), source: "fallback", model: MODEL, note };
  }
}

const isRateLimit = (msg: string) => /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(msg);
const isOverloaded = (msg: string) => /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg);

/** On a per-minute 429, wait the delay Google asks for (if short enough to fit the request budget) and retry once. */
async function withRateLimitRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (isOverloaded(msg)) { await new Promise((r) => setTimeout(r, 2500)); return run(); }
    if (!isRateLimit(msg)) throw e;
    const secs = Number(msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? NaN);
    const wait = Number.isFinite(secs) ? secs : 15;
    if (wait > 30) throw e;
    await new Promise((r) => setTimeout(r, wait * 1000 + 250));
    return run();
  }
}

// ---------------- invoice extraction ----------------

const lineSchema = z.object({ item_code: z.string(), description: z.string(), quantity: z.number(), unit_price: z.number(), amount: z.number() });
const extractionSchema = z.object({
  vendor_name: z.string(), vendor_tax_id: z.string(), invoice_number: z.string(), invoice_date: z.string(), po_number: z.string(), currency: z.string(),
  lines: z.array(lineSchema), subtotal: z.number(), tax: z.number(), total: z.number(),
  evidence: z.array(z.object({ field: z.string(), quote: z.string() })),
});

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: { type: "string", description: "Legal name of the seller" },
    vendor_tax_id: { type: "string", description: "Seller GSTIN, exactly as printed" },
    invoice_number: { type: "string", description: "Invoice / bill number exactly as printed, keep punctuation" },
    invoice_date: { type: "string", description: "Invoice date as ISO YYYY-MM-DD" },
    po_number: { type: "string", description: "Buyer purchase order number referenced on the invoice" },
    currency: { type: "string", description: "ISO currency code" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { item_code: { type: "string" }, description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" }, amount: { type: "number" } },
        required: ["item_code", "description", "quantity", "unit_price", "amount"],
      },
    },
    subtotal: { type: "number", description: "Taxable value before GST" },
    tax: { type: "number", description: "Total GST (IGST, or CGST+SGST combined)" },
    total: { type: "number", description: "Invoice total including tax" },
    evidence: {
      type: "array",
      description: "For each top-level field, the exact text on the document it was read from",
      items: { type: "object", properties: { field: { type: "string" }, quote: { type: "string" } }, required: ["field", "quote"] },
    },
  },
  required: ["vendor_name", "vendor_tax_id", "invoice_number", "invoice_date", "po_number", "currency", "lines", "subtotal", "tax", "total", "evidence"],
};

const EXTRACTION_PROMPT = `You are an accounts-payable clerk. Extract the fields from this vendor invoice.
Rules:
- Copy identifiers (invoice number, GSTIN, PO number, item codes) exactly as printed. Do not "fix" them.
- Numbers are plain numbers without currency symbols or thousands separators.
- Read what the document says even if the arithmetic looks wrong; do not correct it.
- For evidence, quote the shortest exact text span for each of: vendor_name, vendor_tax_id, invoice_number, invoice_date, po_number, total.
- The document is synthetic demo data; that does not change the task.`;

function precomputedExtraction(inv: IncomingInvoice): Extraction {
  return {
    vendor_name: inv.vendor_name, vendor_tax_id: inv.vendor_tax_id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date,
    po_number: inv.po_number, currency: inv.currency, lines: inv.lines, subtotal: inv.subtotal, tax: inv.tax, total: inv.total,
    evidence: {
      vendor_name: inv.vendor_name, vendor_tax_id: inv.vendor_tax_id, invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date, po_number: inv.po_number, total: inv.total.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
    },
  };
}

export async function extractInvoice(ws: string, inv: IncomingInvoice, forceLive = false): Promise<LlmResult<Extraction>> {
  const bytes = await readFile(join(process.cwd(), "public", inv.file));
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  return cachedCall({
    ws, forceLive, key: `extract|${fileHash}`,
    run: () => callGemini([{ inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } }, { text: EXTRACTION_PROMPT }], EXTRACTION_JSON_SCHEMA),
    parse: (raw) => {
      const p = extractionSchema.parse(raw);
      return { ...p, evidence: Object.fromEntries(p.evidence.map((e) => [e.field, e.quote])) };
    },
    fallback: () => precomputedExtraction(inv),
  });
}

// ---------------- mapping suggestions ----------------

export type MappingSuggestion = { target: string; confidence: number; reason: string };

const suggestionSchema = z.object({ target: z.string(), confidence: z.number().min(0).max(1), reason: z.string() });

// Precomputed answers for the fields the deterministic layer cannot verify.
const MAPPING_FALLBACK: Record<string, MappingSuggestion> = {
  "vendorBill.custbody_ref1": { target: "bill_po", confidence: 0.86, reason: "Every value is formatted PO-#### and exists as a purchase order number; a generic 'ref1' custom field holding PO numbers is a common NetSuite pattern." },
  "vendorBill.custbody_svc_date": { target: IGNORE, confidence: 0.62, reason: "Values fall 4 days before the bill date, which looks like a service or delivery date. Invoice date is already mapped from trandate, and AP matching does not need this field." },
  "purchaseOrder.custbody_dept_code": { target: "cost_center", confidence: 0.83, reason: "Values like CC-WH-150 are department cost-centre codes, not GL accounts (GL is the 4-digit 'account' field)." },
};

export async function suggestMapping(ws: string, field: SourceField, candidates: Candidate[]): Promise<LlmResult<MappingSuggestion>> {
  const options = targets.filter((t) => t.record === field.record);
  const prompt = `You map ERP fields for an accounts-payable automation. Source system: NetSuite (record: ${field.record}).
Source field: "${field.field}" (type ${field.type}). Sample values: ${JSON.stringify(field.samples)}.
Deterministic signals for the top candidates: ${JSON.stringify(candidates.slice(0, 3).map((c) => ({ target: c.target, confidence: c.confidence, reason: c.reason })))}.
Target fields:
${options.map((t) => `- ${t.key}: ${t.label} (${t.type}) — ${t.why}`).join("\n")}
- ${IGNORE}: not needed for AP matching
Pick the single best target. Confidence is your probability that a finance controller would agree. Explain in one sentence citing the sample values.`;
  return cachedCall({
    ws, key: `map|${field.key}|${JSON.stringify(field.samples)}`,
    run: () => callGemini([{ text: prompt }], {
      type: "object",
      properties: { target: { type: "string", enum: [...options.map((t) => t.key), IGNORE] }, confidence: { type: "number" }, reason: { type: "string" } },
      required: ["target", "confidence", "reason"],
    }),
    parse: (raw) => suggestionSchema.parse(raw),
    fallback: () => MAPPING_FALLBACK[field.key] ?? { target: candidates[0]?.target ?? IGNORE, confidence: 0.5, reason: "No model available; showing the deterministic best guess." },
  });
}
