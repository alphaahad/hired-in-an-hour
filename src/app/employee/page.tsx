"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CheckCheck, Play } from "lucide-react";
import { Badge, Button, Card, ErrorNote, PageHeader, SourceBadge, api, cx, refreshState } from "@/components/ui";
import { StatusBadge, EXCEPTION_LABEL } from "@/components/status";
import type { MatchResult } from "@/lib/types";
import { inr } from "@/lib/format";

type Row = { id: string; file: string; vendor: string; number: string | null; total: number | null; status: string; match: MatchResult | null; extraction_source: "live" | "cached" | "fallback" | null; bill_id: string | null };

export default function Inbox() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [syncReady, setSyncReady] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api<{ invoices: Row[]; syncReady: boolean }>("/api/invoices").then((r) => { setRows(r.invoices); setSyncReady(r.syncReady); }), []);
  useEffect(() => { load(); }, [load]);

  async function runAll() {
    if (!rows) return;
    setRunning(true); setErr(null);
    const queue = rows.filter((r) => r.status === "queued").map((r) => r.id);
    // In queue order with small concurrency: duplicate checks look at invoices earlier in the queue.
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        setBusy((b) => new Set(b).add(id!));
        try {
          await api("/api/agent/process", { json: { invoiceId: id } });
        } catch (e) {
          setErr((e as Error).message);
          queue.length = 0;
        }
        setBusy((b) => { const n = new Set(b); n.delete(id!); return n; });
        await load();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    refreshState();
  }

  async function approveAllMatched() {
    if (!rows) return;
    const ids = rows.filter((r) => r.status === "matched").map((r) => r.id);
    if (!confirm(`Approve and post ${ids.length} matched bills to NetSuite? Each one is logged and can be reversed.`)) return;
    setApproving(true);
    for (const id of ids) await api(`/api/invoices/${id}/decide`, { json: { decision: "approve" } }).catch((e) => setErr(e.message));
    await load();
    refreshState();
    setApproving(false);
  }

  if (!rows) return <PageHeader eyebrow="Step 4 of 5" title="AP employee" />;
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const queued = by("queued");
  const exceptionTypes = rows.flatMap((r) => r.match?.exceptions.map((e) => e.exceptionType!) ?? []);

  return (
    <div>
      <PageHeader
        eyebrow={by("posted") ? "Step 5 of 5" : "Step 4 of 5"}
        title="AP employee · invoice inbox"
        actions={
          <>
            {by("matched") > 0 && <Button loading={approving} onClick={approveAllMatched}><CheckCheck className="size-4" /> Approve all matched ({by("matched")})</Button>}
            {queued > 0 && <Button variant="primary" loading={running} disabled={!syncReady} onClick={runAll}><Play className="size-4" /> {running ? `Processing… ${20 - queued}/20` : `Process ${queued} invoices`}</Button>}
          </>
        }
      >
        Supervised mode: the employee reads each PDF, runs a 3-way match against the synced POs and receipts, and posts nothing without your approval. Exceptions come with the exact document, field and value.
      </PageHeader>
      {!syncReady && <div className="mb-4"><ErrorNote>The employee only works on data it has synced. <Link className="underline" href="/setup/sync">Run the test sync</Link> first.</ErrorNote></div>}
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["In inbox", queued, "text-ink"],
          ["Matched", by("matched"), "text-accent"],
          ["Exceptions", by("exception"), "text-bad"],
          ["Posted", by("posted"), "text-ok"],
          ["Held / rejected", by("on_hold") + by("rejected"), "text-warn"],
        ].map(([k, n, c]) => (
          <Card key={k as string} className="px-4 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className={cx("font-mono text-2xl font-semibold", c as string)}>{n}</div>
          </Card>
        ))}
      </div>
      {exceptionTypes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Bot className="size-3.5" /> Caught:
          {exceptionTypes.map((t, i) => <Badge key={i} tone="bad">{EXCEPTION_LABEL[t] ?? t}</Badge>)}
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <thead className="bg-gray-50 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">File</th><th className="px-2 py-2 font-medium">Vendor</th><th className="px-2 py-2 font-medium">Invoice no.</th>
              <th className="px-2 py-2 text-right font-medium">Total</th><th className="px-4 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Why</th><th className="px-4 py-2 font-medium">Read by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-gray-50">
                <td className="px-4 py-2"><Link href={`/employee/${r.id}`} className="font-mono text-xs text-accent hover:underline">{r.id}.pdf</Link></td>
                <td className="px-2 py-2 text-ink-2">{r.vendor.replace(" Pvt Ltd", "")}</td>
                <td className="px-2 py-2 font-mono text-xs">{r.number ?? <span className="text-muted">—</span>}</td>
                <td className="px-2 py-2 text-right font-mono text-xs">{r.total !== null ? inr(r.total) : "—"}</td>
                <td className="px-4 py-2">{busy.has(r.id) ? <StatusBadge status="processing" /> : <StatusBadge status={r.status} />}</td>
                <td className="w-full max-w-0 px-2 py-2 text-xs text-ink-2">
                  {r.match?.exceptions.length ? (
                    <span className="block truncate" title={r.match.exceptions[0].detail}>{r.match.exceptions[0].detail}</span>
                  ) : r.status === "posted" ? <span className="font-mono text-muted">{r.bill_id}</span> : r.match ? <span className="block truncate text-muted">{r.match.poId} · {r.match.receiptIds.join(", ")}</span> : null}
                </td>
                <td className="px-4 py-2"><SourceBadge source={r.extraction_source} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
