"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertOctagon, ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleMinus, PartyPopper, RefreshCw } from "lucide-react";
import { Badge, Button, Card, ErrorNote, SourceBadge, api, cx, refreshState } from "@/components/ui";
import { StatusBadge, EXCEPTION_LABEL } from "@/components/status";
import { ActionLog, type ActionRow } from "@/components/ActionLog";
import type { CheckResult, Extraction, MatchResult } from "@/lib/types";
import { inr, shortDate } from "@/lib/format";

type Detail = {
  id: string; file: string; vendor: string; prev: string | null; next: string | null;
  row: { extraction: Extraction | null; extraction_source: "live" | "cached" | "fallback" | null; match: MatchResult | null; status: string; bill_id: string | null } | null;
  actions: ActionRow[];
};

const CHECK_ICON = {
  pass: <CircleCheck className="size-4 text-ok" />,
  warn: <CircleAlert className="size-4 text-warn" />,
  fail: <AlertOctagon className="size-4 text-bad" />,
  skip: <CircleMinus className="size-4 text-muted" />,
};

function Citations({ c }: { c: CheckResult }) {
  if (!c.citations.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-line">
      <table className="w-full text-xs">
        <tbody>
          {c.citations.map((ci, i) => (
            <tr key={i} className="border-t border-line first:border-t-0">
              <td className="bg-gray-50 px-2 py-1.5 text-muted">{ci.doc}<div className="text-ink-2">{ci.field}</div></td>
              <td className="px-2 py-1.5 font-mono font-medium text-bad">{ci.value}</td>
              {ci.against ? (
                <>
                  <td className="px-1 text-muted">vs</td>
                  <td className="bg-gray-50 px-2 py-1.5 text-muted">{ci.against.doc}<div className="text-ink-2">{ci.against.field}</div></td>
                  <td className="px-2 py-1.5 font-mono font-medium text-ink">{ci.against.value}</td>
                </>
              ) : <td colSpan={3} />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed by id so moving between invoices starts from fresh state.
  return <InvoiceDetail key={id} id={id} />;
}

function InvoiceDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const [llmNote, setLlmNote] = useState<string | null>(null);

  const load = useCallback(() => api<Detail>(`/api/invoices/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function process(forceLive = false) {
    setBusy(forceLive ? "live" : "process"); setErr(null);
    try {
      const r = await api<{ note?: string }>("/api/agent/process", { json: { invoiceId: id, forceLive } });
      setLlmNote(r.note ?? null);
      await load(); refreshState();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function decide(decision: "approve" | "hold" | "reject" | "override") {
    setBusy(decision); setErr(null);
    try {
      const r = await api<{ firstEmployee?: boolean }>(`/api/invoices/${id}/decide`, { json: { decision, note } });
      if (r.firstEmployee) setCelebrate(true);
      setNote("");
      await load(); refreshState();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  if (!d) return <div className="text-sm text-muted">{err ?? "Loading…"}</div>;
  const ex = d.row?.extraction, m = d.row?.match, status = d.row?.status ?? "queued";
  const awaiting = status === "matched" || status === "exception";

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/employee" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Inbox</Link>
        <div className="ml-auto flex items-center gap-1">
          {d.prev && <Link href={`/employee/${d.prev}`} className="rounded-md p-1.5 text-muted hover:bg-gray-100"><ChevronLeft className="size-4" /></Link>}
          <span className="font-mono text-xs text-muted">{d.id}</span>
          {d.next && <Link href={`/employee/${d.next}`} className="rounded-md p-1.5 text-muted hover:bg-gray-100"><ChevronRight className="size-4" /></Link>}
        </div>
      </div>

      {celebrate && (
        <Card className="animate-enter mb-4 flex items-center gap-3 border-emerald-200 bg-ok-soft p-4">
          <PartyPopper className="size-5 text-ok" />
          <div className="text-sm"><strong>Your AP employee is working.</strong> First bill posted with a human-approved 3-way match. The timer has stopped. <Link href="/metrics" className="text-accent underline">See the metric</Link></div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
            <span className="font-mono">{d.file.split("/").pop()}</span><span>Source document · mock</span>
          </div>
          <iframe src={`${d.file}#toolbar=0&navpanes=0&view=FitH`} className="h-[780px] w-full bg-gray-100" title="Invoice PDF" />
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <div className="text-xs text-muted">{d.vendor}</div>
                <div className="font-mono text-lg font-semibold">{ex?.invoice_number ?? "Not read yet"}</div>
                {ex && <div className="text-sm text-ink-2">{inr(ex.total)} · {shortDate(ex.invoice_date)} · {ex.po_number}</div>}
              </div>
              <div className="ml-auto flex flex-col items-end gap-1.5">
                <StatusBadge status={status} />
                <div className="flex items-center gap-1.5">
                  <SourceBadge source={d.row?.extraction_source} note={llmNote} />
                  {ex && <button title="Bypass the cache and ask Gemini again" onClick={() => process(true)} className="text-muted hover:text-ink">{busy === "live" ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</button>}
                </div>
              </div>
            </div>
            {llmNote && <p className="mt-2 text-xs text-warn">{llmNote}</p>}

            {!ex && <Button variant="primary" className="mt-4" loading={busy === "process"} onClick={() => process()}>Have the employee read this invoice</Button>}

            {awaiting && m && (
              <div className={cx("mt-4 rounded-md border p-3", status === "matched" ? "border-blue-200 bg-accent-soft" : "border-red-200 bg-bad-soft")}>
                <div className="text-sm font-medium">{status === "matched" ? `Matched against ${m.poId} and ${m.receiptIds.join(", ")}. Post the bill?` : `The employee stopped: ${m.exceptions.map((e) => EXCEPTION_LABEL[e.exceptionType!] ?? e.label).join(", ").toLowerCase()}.`}</div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={status === "matched" ? "Optional note" : "Reason (required to override; optional for hold/reject)"} className="mt-2 w-full rounded-md border border-line-2 bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {status === "matched" ? (
                    <Button variant="primary" loading={busy === "approve"} onClick={() => decide("approve")}><Check className="size-4" /> Approve &amp; post bill</Button>
                  ) : (
                    <>
                      <Button variant="primary" loading={busy === "hold"} onClick={() => decide("hold")}>Hold &amp; query vendor</Button>
                      <Button variant="danger" loading={busy === "reject"} onClick={() => decide("reject")}>Reject</Button>
                      <Button loading={busy === "override"} onClick={() => decide("override")} title="Post anyway; needs a reason, which goes to the audit trail">Override &amp; post</Button>
                    </>
                  )}
                </div>
              </div>
            )}
            {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
          </Card>

          {m && (
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">3-way match</div>
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr><th className="py-1 font-medium">Line</th><th className="font-medium">Item</th><th className="text-right font-medium">Invoice qty</th><th className="text-right font-medium">Received</th><th className="text-right font-medium">PO qty</th><th className="text-right font-medium">Invoice price</th><th className="text-right font-medium">PO price</th></tr>
                </thead>
                <tbody className="font-mono">
                  {m.lineTable.map((l) => {
                    const priceBad = l.po && l.invoice.price > l.po.price * 1.02 + 1e-9;
                    const priceWarn = l.po && !priceBad && l.invoice.price !== l.po.price;
                    const qtyBad = l.received !== null ? l.invoice.qty > l.received : false;
                    return (
                      <tr key={l.line} className="border-t border-line">
                        <td className="py-1.5">{l.line}</td><td>{l.item}</td>
                        <td className={cx("text-right", qtyBad && "font-semibold text-bad")}>{l.invoice.qty}</td>
                        <td className={cx("text-right", l.received === null && "text-bad")}>{l.received ?? "none"}</td>
                        <td className="text-right">{l.po?.qty ?? "—"}</td>
                        <td className={cx("text-right", priceBad && "font-semibold text-bad", priceWarn && "text-warn")}>{inr(l.invoice.price)}</td>
                        <td className="text-right">{l.po ? inr(l.po.price) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="mt-4 space-y-3">
                {m.checks.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <span className="mt-0.5">{CHECK_ICON[c.status]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm"><span className={cx(c.status === "fail" && "font-medium")}>{c.label}</span>{c.status === "fail" && c.exceptionType && <Badge tone="bad">{EXCEPTION_LABEL[c.exceptionType]}</Badge>}</div>
                      <p className="text-xs leading-relaxed text-ink-2">{c.detail}</p>
                      {c.rule && c.status === "fail" && <p className="mt-0.5 text-[11px] text-muted">Rule: {c.rule}</p>}
                      {c.status === "fail" && <Citations c={c} />}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {ex && (
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">What the employee read <span className="font-normal text-muted">(and where)</span></div>
              <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-xs">
                {(["vendor_name", "vendor_tax_id", "invoice_number", "invoice_date", "po_number", "total"] as const).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k.replace(/_/g, " ")}</dt>
                    <dd><span className="font-mono">{k === "total" ? inr(ex.total) : String(ex[k])}</span>{ex.evidence?.[k] && <span className="ml-2 text-muted">“{ex.evidence[k]}”</span>}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card>
            <div className="border-b border-line px-4 py-2.5 text-sm font-medium">Activity on this invoice</div>
            <ActionLog actions={d.actions} onChange={load} />
          </Card>
        </div>
      </div>
    </div>
  );
}
