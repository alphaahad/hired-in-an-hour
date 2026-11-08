// Business logic behind the API routes. Routes stay thin; everything that changes state
// writes an `actions` row (audit trail) and, where it makes sense, can be reversed.
import "server-only";
import { q, q1, json } from "./db";
import { logAction, getAction, track, type Action } from "./audit";
import { getWorkspace, setConnection, setEmployeeName, type Workspace } from "./workspace";
import { incomingInvoices, itemReceipts, purchaseOrders, vendorBills, vendors } from "@/data/seed";
import { proposeMappings, sourceFields, targets, targetByKey, IGNORE, type RecordType } from "./mapping";
import { extractInvoice, suggestMapping, type LlmSource } from "./llm";
import { threeWayMatch, type MatchContext } from "./match";
import type { Extraction, ItemReceipt, MatchResult, PurchaseOrder, Vendor, VendorBill } from "./types";
import { inr } from "./format";
import { draftVendorQuery } from "./narrate";
import { listActions } from "./audit";

// ============ setup ============

/** Hiring the employee starts the clock. The name is optional here so older callers keep working. */
export async function startSetup(name?: string | null) {
  const w = await getWorkspace();
  if (name) await setEmployeeName(w.id, name);
  if (!w.setup_started_at) await q("update workspaces set setup_started_at = now() where id = $1", [w.id]);
  await track(w.id, "setup_started");
  return getWorkspace();
}

export const MOCK_ACCOUNT = "TSTDRV2026417";
export const MOCK_TOKEN_PREFIX = "nsk_sandbox_";

export async function connectErp(accountId: string, token: string) {
  const w = await getWorkspace();
  if (accountId.trim().toUpperCase() !== MOCK_ACCOUNT) return { ok: false as const, error: `Account ${accountId} not found. This demo has one mock sandbox: ${MOCK_ACCOUNT}.` };
  if (!token.startsWith(MOCK_TOKEN_PREFIX)) return { ok: false as const, error: "Token rejected: expected a sandbox token-based-auth key (nsk_sandbox_…)." };
  const counts = { vendor: vendors.length, purchaseOrder: purchaseOrders.length, itemReceipt: itemReceipts.length, vendorBill: vendorBills.length };
  const conn = { accountId: MOCK_ACCOUNT, connectedAt: new Date().toISOString(), counts };
  await setConnection(w.id, conn);
  await logAction({ ws: w.id, actor: "human", type: "erp_connected", target: "erp", summary: `Connected mock NetSuite sandbox ${MOCK_ACCOUNT} (read access to vendors, POs, item receipts, bills)`, after: conn });
  await track(w.id, "erp_connected");
  return { ok: true as const, connection: conn };
}

// ============ mapping ============

export type MappingRow = {
  source_key: string;
  target: string | null;
  confidence: number;
  method: "heuristic" | "llm" | "human";
  reason: string;
  status: "auto" | "needs_review" | "approved" | "ignored";
  llm_source: LlmSource | null;
};

export async function getMappings(ws: string) {
  let rows = await q<MappingRow>("select source_key, target, confidence, method, reason, status, llm_source from mappings where workspace_id = $1", [ws]);
  if (rows.length === 0) {
    const proposals = proposeMappings();
    // LLM only for what the deterministic layer could not verify, in parallel. Policy: an LLM
    // suggestion never auto-approves; it stays "needs_review" whatever its confidence.
    const suggestions = await Promise.all(proposals.map((p) => (p.status === "needs_review" ? suggestMapping(ws, p.source, p.best ? [p.best, ...(p.runnerUp ? [p.runnerUp] : [])] : []) : null)));
    for (const [i, p] of proposals.entries()) {
      const s = suggestions[i];
      const row: MappingRow = s
        ? { source_key: p.source.key, target: s.value.target, confidence: Math.round(s.value.confidence * 100) / 100, method: "llm", reason: `${s.value.reason} (Rules alone: ${p.best?.reason ?? "no candidate"}.)`, status: "needs_review", llm_source: s.source }
        : { source_key: p.source.key, target: p.best!.target, confidence: p.best!.confidence, method: "heuristic", reason: p.best!.reason, status: "auto", llm_source: null };
      await q("insert into mappings (workspace_id, source_key, target, confidence, method, reason, status, llm_source) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [ws, row.source_key, row.target, row.confidence, row.method, row.reason, row.status, row.llm_source]);
    }
    rows = await q<MappingRow>("select source_key, target, confidence, method, reason, status, llm_source from mappings where workspace_id = $1", [ws]);
  }
  const order = sourceFields.map((s) => s.key);
  return rows
    .sort((a, b) => order.indexOf(a.source_key) - order.indexOf(b.source_key))
    .map((r) => ({ ...r, source: sourceFields.find((s) => s.key === r.source_key)! }));
}

export async function decideMapping(ws: string, sourceKey: string, target: string) {
  const before = await q1<MappingRow>("select target, status, method, confidence from mappings where workspace_id = $1 and source_key = $2", [ws, sourceKey]);
  if (!before) throw new Error("Unknown mapping");
  const status = target === IGNORE ? "ignored" : "approved";
  await q("update mappings set target = $3, status = $4, method = case when target = $3 then method else 'human' end, updated_at = now() where workspace_id = $1 and source_key = $2", [ws, sourceKey, target, status]);
  const label = target === IGNORE ? "not needed (ignored)" : targetByKey(target)?.label;
  await logAction({
    ws, actor: "human", type: "mapping_decision", target: `mapping:${sourceKey}`, reversible: true,
    summary: `${before.target === target ? "Approved" : "Changed"} ${sourceKey} → ${label}`,
    before, after: { target, status },
  });
  const pending = await q1<{ n: number }>("select count(*)::int as n from mappings where workspace_id = $1 and status = 'needs_review'", [ws]);
  if (pending?.n === 0) await track(ws, "mappings_approved");
  return { pending: pending?.n ?? 0 };
}

// ============ sync ============

const RECORDS: { type: RecordType; label: string; rows: () => Record<string, unknown>[]; id: (r: Record<string, unknown>) => string }[] = [
  { type: "vendor", label: "vendors", rows: () => vendors as never, id: (r) => String(r.id) },
  { type: "purchaseOrder", label: "purchase orders", rows: () => purchaseOrders as never, id: (r) => String(r.tranId) },
  { type: "itemReceipt", label: "item receipts", rows: () => itemReceipts as never, id: (r) => String(r.tranId) },
  { type: "vendorBill", label: "historical bills", rows: () => vendorBills as never, id: (r) => `${r.tranId}` },
];

function readPath(rec: Record<string, unknown>, path: string): unknown {
  const [head, sub] = path.split(".");
  const v = rec[head];
  return sub && Array.isArray(v) ? v.map((x) => (x as Record<string, unknown>)[sub]) : v;
}

/** Apply the approved mapping to one raw record and validate required canonical fields. */
export function transform(type: RecordType, raw: Record<string, unknown>, mapping: MappingRow[]) {
  const canonical: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const m of mapping) {
    const [rec, ...rest] = m.source_key.split(".");
    if (rec !== type || !m.target || m.target === IGNORE || m.status === "needs_review") continue;
    canonical[m.target] = readPath(raw, rest.join("."));
  }
  for (const t of targets.filter((t) => t.record === type && t.required)) {
    const mapped = mapping.some((m) => m.target === t.key && m.status !== "needs_review");
    const v = canonical[t.key];
    if (!mapped) errors.push(`${t.label} has no mapped source field`);
    else if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.some((x) => x === "" || x == null))) errors.push(`${t.label} is empty`);
  }
  return { canonical, errors };
}

export type SyncLogLine = { t: number; level: "info" | "ok" | "warn" | "error"; msg: string; record?: string };

export async function* runSync(ws: string): AsyncGenerator<SyncLogLine | { done: true; runId: string; summary: SyncSummary }> {
  const mapping = (await getMappings(ws)) as MappingRow[];
  const pending = mapping.filter((m) => m.status === "needs_review");
  const t0 = Date.now();
  const line = (level: SyncLogLine["level"], msg: string, record?: string): SyncLogLine => ({ t: Date.now() - t0, level, msg, record });
  if (pending.length) {
    yield line("error", `${pending.length} field mapping(s) still need review. Sync blocked.`);
    return;
  }
  const runId = "sync_" + crypto.randomUUID().slice(0, 8);
  // Re-running replaces the previous test sync.
  await q("delete from synced_records where workspace_id = $1", [ws]);
  await q("insert into sync_runs (id, workspace_id, status) values ($1, $2, 'running')", [runId, ws]);
  yield line("info", `Test sync ${runId} started against mock NetSuite ${MOCK_ACCOUNT} using ${mapping.filter((m) => m.status !== "ignored").length} mapped fields`);

  const summary: SyncSummary = { total: 0, ok: 0, failed: 0, byType: {}, failures: [] };
  for (const r of RECORDS) {
    const rows = r.rows();
    yield line("info", `GET /record/v1/${r.type} → ${rows.length} ${r.label}`);
    const st = { ok: 0, failed: 0 };
    for (const raw of rows) {
      const id = r.id(raw);
      const { canonical, errors } = transform(r.type, raw, mapping);
      const status = errors.length ? "failed" : "ok";
      await q("insert into synced_records (workspace_id, run_id, record_type, record_id, status, error, payload) values ($1,$2,$3,$4,$5,$6,$7)",
        [ws, runId, r.type, id, status, errors.join("; ") || null, json({ raw, canonical })]);
      summary.total++;
      if (errors.length) {
        st.failed++; summary.failed++;
        summary.failures.push({ type: r.type, id, error: errors.join("; ") });
        yield line("warn", `${r.type} ${id}: ${errors.join("; ")}. Quarantined, not synced`, id);
      } else {
        st.ok++; summary.ok++;
        yield line("ok", `${r.type} ${id} synced`, id);
      }
      await new Promise((res) => setTimeout(res, 25)); // throttled so the log is readable; see DECISIONS.md
    }
    summary.byType[r.type] = st;
  }
  const status = summary.failed ? "partial" : "succeeded";
  await q("update sync_runs set status = $3, finished_at = now(), summary = $4 where id = $1 and workspace_id = $2", [runId, ws, status, json(summary)]);
  await logAction({
    ws, actor: "system", type: "sync_run", target: `sync:${runId}`, reversible: true,
    summary: `Test sync ${status === "partial" ? "partially succeeded" : "succeeded"}: ${summary.ok}/${summary.total} records synced, ${summary.failed} quarantined`,
    after: summary,
  });
  // Pass criterion: every record type has data and nothing the matcher depends on is missing wholesale.
  const passed = Object.values(summary.byType).every((s) => s.ok > 0) && summary.failed / summary.total < 0.1;
  if (passed) await track(ws, "test_sync_passed", { ok: summary.ok, failed: summary.failed });
  yield line(passed ? "ok" : "error", passed
    ? `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. ${summary.ok} synced, ${summary.failed} quarantined with reasons. Safe to start the AP employee.`
    : `Done, but ${summary.failed} of ${summary.total} records failed. Fix the mapping before going live.`);
  yield { done: true, runId, summary };
}

export type SyncSummary = { total: number; ok: number; failed: number; byType: Record<string, { ok: number; failed: number }>; failures: { type: string; id: string; error: string }[] };

export async function undoSync(ws: string, runId: string, viaAction?: string) {
  const run = await q1<{ status: string }>("select status from sync_runs where id = $1 and workspace_id = $2", [runId, ws]);
  if (!run || run.status === "undone") return { ok: false, error: "Nothing to undo" };
  const n = await q1<{ n: number }>("select count(*)::int as n from synced_records where workspace_id = $1 and run_id = $2 and status = 'ok'", [ws, runId]);
  await q("delete from synced_records where workspace_id = $1 and run_id = $2", [ws, runId]);
  await q("update sync_runs set status = 'undone' where id = $1 and workspace_id = $2", [runId, ws]);
  const orig = await q1<{ id: string }>("select id from actions where workspace_id = $1 and target = $2 and type = 'sync_run' order by ts desc limit 1", [ws, `sync:${runId}`]);
  await logAction({ ws, actor: "human", type: "sync_undone", target: `sync:${runId}`, summary: `Undid test sync ${runId}: removed ${n?.n ?? 0} records from the workspace. NetSuite was never written to`, reverses: viaAction ?? orig?.id });
  await track(ws, "sync_undone");
  return { ok: true, removed: n?.n ?? 0 };
}

export const latestSync = (ws: string) =>
  q1<{ id: string; status: string; summary: SyncSummary | null; started_at: string }>("select id, status, summary, started_at from sync_runs where workspace_id = $1 order by started_at desc limit 1", [ws]);

// ============ AP employee ============

export type InvoiceRow = {
  invoice_id: string;
  extraction: Extraction | null;
  extraction_source: LlmSource | null;
  match: MatchResult | null;
  status: "queued" | "processing" | "matched" | "exception" | "posted" | "on_hold" | "rejected";
  bill_id: string | null;
  updated_at: string;
};

async function matchContext(ws: string, excludeInvoice: string): Promise<MatchContext> {
  const synced = await q<{ record_type: RecordType; payload: { raw: unknown } }>("select record_type, payload from synced_records where workspace_id = $1 and status = 'ok'", [ws]);
  const of = <T,>(t: RecordType) => synced.filter((s) => s.record_type === t).map((s) => s.payload.raw as T);
  const posted = await q<{ data: VendorBill }>("select data from erp_writes where workspace_id = $1 and record_type = 'vendorBill' and status = 'open'", [ws]);
  const prior = await q<InvoiceRow>("select * from invoice_results where workspace_id = $1 and invoice_id <> $2 and extraction is not null and status <> 'rejected'", [ws, excludeInvoice]);
  return {
    vendors: of<Vendor>("vendor"),
    purchaseOrders: of<PurchaseOrder>("purchaseOrder"),
    receipts: of<ItemReceipt>("itemReceipt"),
    bills: [...of<VendorBill>("vendorBill"), ...posted.map((p) => p.data)],
    priorInvoices: prior
      .filter((p) => p.match?.vendorId && p.invoice_id < excludeInvoice) // earlier in the queue
      .map((p) => ({ invoiceId: p.invoice_id, vendorId: p.match!.vendorId!, invoice_number: p.extraction!.invoice_number, total: p.extraction!.total, date: p.extraction!.invoice_date })),
  };
}

export async function listInvoices(ws: string) {
  const rows = await q<InvoiceRow>("select * from invoice_results where workspace_id = $1", [ws]);
  return incomingInvoices.map((inv) => {
    const r = rows.find((x) => x.invoice_id === inv.id);
    return { id: inv.id, file: inv.file, vendor: inv.vendor_name, number: r?.extraction?.invoice_number ?? null, total: r?.extraction?.total ?? null, status: r?.status ?? "queued", match: r?.match ?? null, extraction_source: r?.extraction_source ?? null, bill_id: r?.bill_id ?? null };
  });
}

export async function processInvoice(ws: string, invoiceId: string, forceLive = false) {
  const inv = incomingInvoices.find((i) => i.id === invoiceId);
  if (!inv) throw new Error("Unknown invoice");
  const sync = await latestSync(ws);
  if (!sync || sync.status === "undone" || sync.status === "running") return { ok: false as const, error: "Run a test sync first: the AP employee only works on data it has synced." };
  const existing = await q1<InvoiceRow>("select * from invoice_results where workspace_id = $1 and invoice_id = $2", [ws, invoiceId]);
  if (existing && ["posted", "on_hold", "rejected"].includes(existing.status) && !forceLive) return { ok: true as const, row: existing };

  await track(ws, "agent_started");
  const ex = await extractInvoice(ws, inv, forceLive);
  const match = threeWayMatch(invoiceId, ex.value, await matchContext(ws, invoiceId));
  const status = match.status === "matched" ? "matched" : "exception";
  await q(`insert into invoice_results (workspace_id, invoice_id, extraction, extraction_source, match, status, updated_at) values ($1,$2,$3,$4,$5,$6, now())
           on conflict (workspace_id, invoice_id) do update set extraction = excluded.extraction, extraction_source = excluded.extraction_source, match = excluded.match, status = excluded.status, updated_at = now()`,
    [ws, invoiceId, json(ex.value), ex.source, json(match), status]);
  await logAction({
    ws, actor: "agent", type: "invoice_extracted", target: `invoice:${invoiceId}`,
    summary: `Read ${ex.value.invoice_number} from ${inv.file.split("/").pop()} (${ex.source === "live" ? `${ex.model}, live` : ex.source === "cached" ? `${ex.model}, cached` : "precomputed fallback"}): ${ex.value.lines.length} lines, total ${inr(ex.value.total)}`,
    evidence: { file: inv.file, quotes: ex.value.evidence, source: ex.source, note: ex.note ?? null },
    after: { invoice_number: ex.value.invoice_number, total: ex.value.total },
  });
  await logAction({
    ws, actor: "agent", type: "invoice_matched", target: `invoice:${invoiceId}`,
    summary: match.status === "matched"
      ? `3-way match passed against ${match.poId} and ${match.receiptIds.join(", ")}. Ready for approval`
      : `3-way match raised ${match.exceptions.length} exception(s): ${match.exceptions.map((e) => e.label.toLowerCase()).join(", ")}. Waiting for a human`,
    evidence: { checks: match.checks.map((c) => ({ label: c.label, status: c.status, detail: c.detail, citations: c.citations })) },
    after: { status },
  });
  return { ok: true as const, row: (await q1<InvoiceRow>("select * from invoice_results where workspace_id = $1 and invoice_id = $2", [ws, invoiceId]))!, source: ex.source, note: ex.note };
}

export async function getInvoice(ws: string, invoiceId: string) {
  const inv = incomingInvoices.find((i) => i.id === invoiceId);
  if (!inv) return null;
  const row = await q1<InvoiceRow>("select * from invoice_results where workspace_id = $1 and invoice_id = $2", [ws, invoiceId]);
  const actions = await q<Action>("select * from actions where workspace_id = $1 and target = $2 order by ts desc", [ws, `invoice:${invoiceId}`]);
  const idx = incomingInvoices.findIndex((i) => i.id === invoiceId);
  return { id: inv.id, file: inv.file, vendor: inv.vendor_name, row, actions, prev: incomingInvoices[idx - 1]?.id ?? null, next: incomingInvoices[idx + 1]?.id ?? null };
}

export type Decision = "approve" | "hold" | "reject" | "override";

export async function decideInvoice(ws: string, invoiceId: string, decision: Decision, note = "") {
  const row = await q1<InvoiceRow>("select * from invoice_results where workspace_id = $1 and invoice_id = $2", [ws, invoiceId]);
  if (!row || !row.extraction || !row.match) return { ok: false as const, error: "Invoice has not been processed yet" };
  const ex = row.extraction, m = row.match;
  if (decision === "approve" && row.status !== "matched") return { ok: false as const, error: "Only matched invoices can be approved. Use override with a reason." };
  if (decision === "override" && note.trim().length < 5) return { ok: false as const, error: "An override needs a written reason (it goes in the audit trail)." };
  if (!["matched", "exception"].includes(row.status)) return { ok: false as const, error: `Invoice is already ${row.status}. Reverse that first.` };

  const before = { status: row.status, bill_id: row.bill_id };
  if (decision === "approve" || decision === "override") {
    const vendor = vendors.find((v) => v.id === m.vendorId);
    const po = purchaseOrders.find((p) => p.tranId === m.poId);
    const n = (await q1<{ n: number }>("select count(*)::int as n from erp_writes where workspace_id = $1", [ws]))!.n;
    const billId = `VB-${9001 + n}`;
    const bill: VendorBill = {
      id: billId, tranId: ex.invoice_number, entity: m.vendorId ?? "?", trandate: ex.invoice_date,
      duedate: ex.invoice_date, custbody_ref1: ex.po_number, custbody_svc_date: "", account: po?.account ?? "", usertotal: ex.total, currency: "INR", status: "pendingApproval",
    };
    if (vendor) {
      const d = new Date(ex.invoice_date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + parseInt(vendor.terms.replace(/\D/g, ""), 10));
      bill.duedate = d.toISOString().slice(0, 10);
    }
    await q("insert into erp_writes (workspace_id, id, record_type, data, status) values ($1,$2,'vendorBill',$3,'open')", [ws, billId, json(bill)]);
    await q("update invoice_results set status = 'posted', bill_id = $3, updated_at = now() where workspace_id = $1 and invoice_id = $2", [ws, invoiceId, billId]);
    await logAction({
      ws, actor: "agent", type: "bill_posted", target: `invoice:${invoiceId}`, reversible: true,
      summary: decision === "approve"
        ? `Posted vendor bill ${billId} to mock NetSuite for ${inr(ex.total)} (${ex.invoice_number}, ${m.poId}, GL ${bill.account}, due ${bill.duedate}) after human approval`
        : `Posted vendor bill ${billId} for ${inr(ex.total)} OVERRIDING ${m.exceptions.length} exception(s). Reason: "${note.trim()}"`,
      evidence: { decision, note: note.trim() || null, exceptions: m.exceptions.map((e) => e.detail) },
      before, after: { status: "posted", bill_id: billId, bill },
    });
    const first = await track(ws, "first_bill_posted", { invoiceId, decision });
    if (first) await q("update workspaces set first_employee_at = now() where id = $1 and first_employee_at is null", [ws]);
    return { ok: true as const, billId, firstEmployee: first };
  }
  const status = decision === "hold" ? "on_hold" : "rejected";
  const w = await q1<{ employee_name: string | null }>("select employee_name from workspaces where id = $1", [ws]);
  const vendorName = vendors.find((v) => v.id === m.vendorId)?.companyName ?? ex.vendor_name;
  const draft = decision === "hold" ? draftVendorQuery(w?.employee_name ?? "Your AP employee", vendorName, ex, m) : null;
  await q("update invoice_results set status = $3, updated_at = now() where workspace_id = $1 and invoice_id = $2", [ws, invoiceId, status]);
  await logAction({
    ws, actor: "human", type: decision === "hold" ? "invoice_held" : "invoice_rejected", target: `invoice:${invoiceId}`, reversible: true,
    summary: decision === "hold"
      ? `Put ${ex.invoice_number} on hold${note ? `: "${note}"` : ""}. Vendor query drafted (not sent: email is out of scope)`
      : `Rejected ${ex.invoice_number}${note ? `: "${note}"` : ""}. No bill created`,
    evidence: { note: note || null, exceptions: m.exceptions.map((e) => e.detail), draft },
    before, after: { status },
  });
  return { ok: true as const };
}

// ============ reversal ============

export async function reverseAction(ws: string, actionId: string): Promise<{ ok: boolean; error?: string }> {
  const a = await getAction(ws, actionId);
  if (!a) return { ok: false, error: "Action not found" };
  if (!a.reversible) return { ok: false, error: "This action is not reversible" };
  if (a.reversed_by) return { ok: false, error: "Already reversed" };
  const before = a.before as Record<string, unknown> | null;
  const after = a.after as Record<string, unknown> | null;

  if (a.type === "mapping_decision") {
    const key = a.target.replace("mapping:", "");
    const sync = await latestSync(ws);
    await q("update mappings set target = $3, status = $4, method = $5, updated_at = now() where workspace_id = $1 and source_key = $2",
      [ws, key, before?.target ?? null, before?.status === "auto" ? "auto" : "needs_review", before?.method ?? "heuristic"]);
    await logAction({ ws, actor: "human", type: "mapping_reverted", target: a.target, summary: `Reverted mapping decision for ${key}. Back to review${sync && sync.status !== "undone" ? ". Re-run the test sync to apply" : ""}`, reverses: a.id });
    return { ok: true };
  }
  if (a.type === "sync_run") {
    return undoSync(ws, a.target.replace("sync:", ""), a.id);
  }
  if (a.type === "bill_posted") {
    const billId = String(after?.bill_id);
    await q("update erp_writes set status = 'voided' where workspace_id = $1 and id = $2", [ws, billId]);
    const invoiceId = a.target.replace("invoice:", "");
    await q("update invoice_results set status = $3, bill_id = null, updated_at = now() where workspace_id = $1 and invoice_id = $2", [ws, invoiceId, before?.status ?? "matched"]);
    await logAction({ ws, actor: "human", type: "bill_voided", target: a.target, summary: `Reversed: voided bill ${billId} in mock NetSuite (compensating entry, original kept for audit). Invoice back to "${before?.status}"`, reverses: a.id, before: after, after: before });
    await track(ws, "action_reversed", { type: a.type });
    return { ok: true };
  }
  if (a.type === "invoice_held" || a.type === "invoice_rejected") {
    const invoiceId = a.target.replace("invoice:", "");
    await q("update invoice_results set status = $3, updated_at = now() where workspace_id = $1 and invoice_id = $2", [ws, invoiceId, before?.status ?? "exception"]);
    await logAction({ ws, actor: "human", type: "decision_reversed", target: a.target, summary: `Reversed ${a.type === "invoice_held" ? "hold" : "rejection"}. Invoice back to "${before?.status}"`, reverses: a.id, before: after, after: before });
    await track(ws, "action_reversed", { type: a.type });
    return { ok: true };
  }
  return { ok: false, error: `No reversal defined for ${a.type}` };
}

// ============ checklist state ============

export async function checklist(w?: Workspace) {
  w ??= await getWorkspace();
  const ws = w.id;
  const [m, sync, inv, ev] = await Promise.all([
    q<{ status: string }>("select status from mappings where workspace_id = $1", [ws]),
    latestSync(ws),
    q<{ status: string }>("select status from invoice_results where workspace_id = $1", [ws]),
    q<{ name: string; ts: string }>("select name, ts from events where workspace_id = $1 order by ts", [ws]),
  ]);
  const has = (n: string) => ev.some((e) => e.name === n);
  const syncOk = !!sync && sync.status !== "undone" && sync.status !== "running";
  return {
    workspace: { id: w.id, internal: w.is_internal, setupStartedAt: w.setup_started_at, firstEmployeeAt: w.first_employee_at, now: new Date().toISOString() },
    employee: { name: w.employee_name },
    steps: [
      { key: "connect", label: "Connect NetSuite", href: "/setup/connect", done: !!w.connection, detail: w.connection ? `Sandbox ${w.connection.accountId}` : "Read-only sandbox access" },
      { key: "mapping", label: "Review field mappings", href: "/setup/mapping", done: m.length > 0 && m.every((x) => x.status !== "needs_review"), detail: m.length ? `${m.filter((x) => x.status === "needs_review").length} need you` : "Auto-mapped with confidence" },
      { key: "sync", label: "Run a test sync", href: "/setup/sync", done: syncOk, detail: syncOk ? `${sync!.summary?.ok ?? 0} records synced` : "Undo any time" },
      { key: "agent", label: "Let the AP employee work", href: "/employee", done: inv.length > 0, detail: inv.length ? `${inv.length}/20 invoices processed` : "20 invoices in the inbox" },
      { key: "first", label: "Approve its first bill", href: "/employee", done: has("first_bill_posted"), detail: has("first_bill_posted") ? "Working employee" : "Supervised mode" },
    ],
  };
}

// ============ the desk: everything the coworker view needs, in one read ============

export async function deskState() {
  const w = await getWorkspace();
  const ws = w.id;
  const [mappings, sync, invoices, actions, rows] = await Promise.all([
    w.connection ? getMappings(ws) : Promise.resolve([]),
    latestSync(ws),
    listInvoices(ws),
    listActions(ws),
    q<InvoiceRow>("select invoice_id, extraction from invoice_results where workspace_id = $1", [ws]),
  ]);
  const ex = new Map(rows.map((r) => [r.invoice_id, r.extraction]));
  return {
    employee: { name: w.employee_name },
    workspace: { internal: w.is_internal, setupStartedAt: w.setup_started_at, firstEmployeeAt: w.first_employee_at, now: new Date().toISOString() },
    connection: w.connection,
    mapping: {
      total: mappings.length,
      auto: mappings.filter((m) => m.status === "auto").length,
      review: mappings.filter((m) => m.method === "llm" || m.method === "human" || m.status === "needs_review").length,
      pending: mappings.filter((m) => m.status === "needs_review"),
      targets: targets.map(({ key, label, record }) => ({ key, label, record })),
      ignore: IGNORE,
    },
    sync: sync ?? null,
    invoices: invoices.map((i) => ({ ...i, extraction: ex.get(i.id) ?? null, vendorId: i.match?.vendorId ?? null })),
    actions,
  };
}
