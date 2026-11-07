"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Play, Undo2 } from "lucide-react";
import { Badge, Button, Card, ErrorNote, PageHeader, api, cx, refreshState } from "@/components/ui";

type Line = { t: number; level: "info" | "ok" | "warn" | "error"; msg: string; record?: string };
type Summary = { total: number; ok: number; failed: number; byType: Record<string, { ok: number; failed: number }>; failures: { type: string; id: string; error: string }[] };
type Run = { id: string; status: "running" | "succeeded" | "partial" | "undone"; summary: Summary | null; started_at: string };

const TYPE_LABEL: Record<string, string> = { vendor: "Vendors", purchaseOrder: "Purchase orders", itemReceipt: "Item receipts", vendorBill: "Historical bills" };

export default function SyncPage() {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api<{ run: Run | null }>("/api/sync").then((r) => setRun(r.run)); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [lines]);

  async function start() {
    setRunning(true); setErr(null); setLines([]); setUndone(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop()!;
        const parsed = parts.filter(Boolean).map((p) => JSON.parse(p));
        const newLines = parsed.filter((p) => !p.done) as Line[];
        if (newLines.length) setLines((l) => [...l, ...newLines]);
        const fin = parsed.find((p) => p.done);
        if (fin) setRun({ id: fin.runId, status: fin.summary.failed ? "partial" : "succeeded", summary: fin.summary, started_at: new Date().toISOString() });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      refreshState();
    }
  }

  async function undo() {
    if (!run) return;
    setUndoing(true);
    try {
      const r = await api<{ removed: number }>("/api/sync/undo", { json: { runId: run.id } });
      setUndone(r.removed);
      setRun({ ...run, status: "undone" });
      refreshState();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUndoing(false);
    }
  }

  const live = run && run.status !== "undone" && run.status !== "running";
  const counts = lines.reduce((a, l) => ({ ok: a.ok + (l.level === "ok" && l.record ? 1 : 0), warn: a.warn + (l.level === "warn" ? 1 : 0) }), { ok: 0, warn: 0 });

  return (
    <div>
      <PageHeader
        eyebrow="Step 3 of 5"
        title="Run a test sync"
        actions={live && !running ? <Button variant="primary" onClick={() => router.push("/employee")}>Start the AP employee <ArrowRight className="size-4" /></Button> : undefined}
      >
        Pulls every vendor, PO, item receipt and historical bill through your mapping into the employee&apos;s workspace. Records that fail validation are quarantined with a reason, not dropped silently. NetSuite is only read.
      </PageHeader>
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}

      {live && run.summary && !running && (
        <Card className="mb-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={run.status === "partial" ? "warn" : "ok"}>{run.status === "partial" ? "Partial success" : "Succeeded"}</Badge>
            <span className="text-sm"><strong className="tabular-nums">{run.summary.ok}</strong> of {run.summary.total} records synced · <strong className="tabular-nums">{run.summary.failed}</strong> quarantined</span>
            <span className="font-mono text-xs text-muted">{run.id}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" onClick={start}><Play className="size-3.5" /> Re-run</Button>
              <Button size="sm" variant="danger" loading={undoing} onClick={undo}><Undo2 className="size-3.5" /> Undo this sync</Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(run.summary.byType).map(([t, s]) => (
              <div key={t} className="rounded-md border border-line px-3 py-2">
                <div className="text-xs text-muted">{TYPE_LABEL[t]}</div>
                <div className="mt-0.5 text-sm"><span className="text-ok">{s.ok} ok</span>{s.failed > 0 && <span className="text-warn"> · {s.failed} quarantined</span>}</div>
              </div>
            ))}
          </div>
          {run.summary.failures.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-warn-soft p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-warn"><AlertTriangle className="size-4" /> Quarantined records</div>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {run.summary.failures.map((f) => <li key={f.type + f.id}><span className="text-xs">{f.type} {f.id}</span>: {f.error}</li>)}
              </ul>
              <p className="mt-2 text-xs text-muted">These are fixed in NetSuite, not here. They are historical bills, so the employee can still start; duplicate checks just won&apos;t see these two.</p>
            </div>
          )}
        </Card>
      )}

      {undone !== null && (
        <Card className="mb-4 flex items-center gap-3 p-4 text-sm">
          <Undo2 className="size-4 text-muted" /> Undone. {undone} records removed from the employee&apos;s workspace; NetSuite was never written to. The employee is paused until you sync again.
          <Button size="sm" variant="primary" className="ml-auto" onClick={start}><Play className="size-3.5" /> Run again</Button>
        </Card>
      )}

      {(!run || run.status === "undone") && !running && lines.length === 0 && undone === null && (
        <Card className="p-6">
          <div className="text-sm text-ink-2">78 records across 4 record types will be pulled, transformed with your 22 field decisions, and validated against required fields.</div>
          <Button variant="primary" className="mt-4" onClick={start}><Play className="size-4" /> Run test sync</Button>
        </Card>
      )}

      {(running || lines.length > 0) && (
        <Card>
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span className={cx("size-2 rounded-full", running ? "animate-pulse bg-accent" : "bg-gray-300")} />
            {running ? "Syncing" : "Log"} · <span className="text-ok">{counts.ok} synced</span> · <span className="text-warn">{counts.warn} quarantined</span>
          </div>
          <div ref={logRef} className="h-80 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-14 shrink-0 text-right text-gray-400">{(l.t / 1000).toFixed(2)}s</span>
                <span className={cx(l.level === "ok" && "text-ok", l.level === "warn" && "text-warn", l.level === "error" && "text-bad", l.level === "info" && "text-ink")}>{l.msg}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
