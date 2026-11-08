"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ExternalLink, FileText, KeyRound, Mail, PartyPopper, RefreshCw, Undo2 } from "lucide-react";
import { Badge, Button, SourceBadge, cx } from "@/components/ui";
import { Citations } from "@/components/Citations";
import { EXCEPTION_LABEL } from "@/components/status";
import { draftVendorQuery } from "@/lib/narrate";
import { duration, inr } from "@/lib/format";
import type { DeskInvoice, DeskState, PendingMapping, SyncProgress } from "./useDesk";

const RECORD: Record<string, string> = { vendor: "vendor", purchaseOrder: "purchase order", itemReceipt: "goods receipt", vendorBill: "vendor bill" };

function Ask({ children, tone = "accent", className }: { children: React.ReactNode; tone?: "accent" | "bad" | "ok" | "neutral"; className?: string }) {
  return (
    <div className={cx("animate-enter rounded-xl border bg-surface p-4", className,
      tone === "bad" ? "border-red-200" : tone === "ok" ? "border-emerald-200 bg-ok-soft" : tone === "accent" ? "border-blue-200" : "border-line")}>
      {children}
    </div>
  );
}

export function ConnectCard({ busy, onGrant }: { busy: boolean; onGrant: () => void }) {
  return (
    <Ask>
      <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-accent" /> Can I have read-only access to NetSuite?</div>
      <p className="mt-1 text-sm text-ink-2">I&apos;ll only read vendors, purchase orders, goods receipts and past bills. I can&apos;t write anything until you approve a bill.</p>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1 rounded-md bg-gray-50 p-2.5 text-xs">
        <dt className="text-muted">Account</dt><dd className="font-mono">TSTDRV2026417</dd>
        <dt className="text-muted">Auth</dt><dd>Token-based, read-only role</dd>
        <dt className="text-muted">Sandbox</dt><dd>Mock NetSuite, credentials pre-filled</dd>
      </dl>
      <Button variant="primary" className="mt-3 w-full" loading={busy} onClick={onGrant}>Grant read-only access</Button>
    </Ask>
  );
}

export function MappingQuestion({ m, targets, ignore, busy, onDecide }: {
  m: PendingMapping; targets: DeskState["mapping"]["targets"]; ignore: string; busy: boolean; onDecide: (target: string) => void;
}) {
  const [why, setWhy] = useState(false);
  const skip = m.target === ignore;
  const label = targets.find((t) => t.key === m.target)?.label ?? m.target;
  const options = targets.filter((t) => t.record === m.source.record && t.key !== m.target);
  return (
    <Ask>
      <div className="text-sm">
        The {RECORD[m.source.record]} field <code className="rounded bg-gray-100 px-1 font-mono text-[12px]">{m.source.field}</code> holds values like
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {m.source.samples.slice(0, 3).map((s) => <code key={s} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{s}</code>)}
      </div>
      <p className="mt-2 text-sm font-medium">
        {skip ? <>I don&apos;t think I need this one. Skip it?</> : <>I think it&apos;s the <span className="text-accent">{label}</span>. Right?</>}
        <span className="ml-1.5 text-xs font-normal text-muted">{Math.round(m.confidence * 100)}% sure</span>
      </p>
      <button onClick={() => setWhy((w) => !w)} className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ChevronDown className={cx("size-3 transition-transform", why && "rotate-180")} /> Why I think so <SourceBadge source={m.llm_source} />
      </button>
      {why && <p className="animate-enter mt-1 text-xs leading-relaxed text-ink-2">{m.reason}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => onDecide(m.target ?? ignore)}><Check className="size-3.5" /> {skip ? "Yes, skip it" : "Yes, that's right"}</Button>
        <select value="" disabled={busy} onChange={(e) => e.target.value && onDecide(e.target.value)}
          className="h-7 rounded-md border border-line-2 bg-surface px-1.5 text-xs text-ink-2" aria-label="It's something else">
          <option value="">It&apos;s something else…</option>
          {options.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          {!skip && <option value={ignore}>Not needed</option>}
        </select>
      </div>
    </Ask>
  );
}

export function SyncCard({ sync, undone, onSyncAgain }: { sync: SyncProgress | null; undone: boolean; onSyncAgain: () => void }) {
  if (sync?.running) {
    const pct = Math.round(((sync.ok + sync.failed) / sync.total) * 100);
    return (
      <Ask tone="neutral">
        <div className="text-sm font-medium">Running a test sync. Nothing is written to NetSuite.</div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>
        <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums"><span>{sync.ok} in · {sync.failed} set aside</span><span>{sync.ok + sync.failed}/{sync.total}</span></div>
        <div className="mt-2 truncate font-mono text-[11px] text-muted">{sync.lines.at(-1)?.msg}</div>
      </Ask>
    );
  }
  if (undone) {
    return (
      <Ask>
        <div className="text-sm font-medium">You undid the test sync, so I&apos;ve stopped.</div>
        <p className="mt-1 text-sm text-ink-2">I only work on data I&apos;ve synced. Sync again when you&apos;re ready.</p>
        <Button size="sm" variant="primary" className="mt-3" onClick={onSyncAgain}><RefreshCw className="size-3.5" /> Run the test sync again</Button>
      </Ask>
    );
  }
  return null;
}

export function CelebrationCard({ name, desk }: { name: string; desk: DeskState }) {
  const took = new Date(desk.workspace.firstEmployeeAt!).getTime() - new Date(desk.workspace.setupStartedAt!).getTime();
  return (
    <Ask tone="ok">
      <div className="flex items-start gap-2.5">
        <PartyPopper className="mt-0.5 size-5 text-ok" />
        <div>
          <div className="text-sm font-semibold">{name} is productive.</div>
          <p className="text-sm text-ink-2">First bill posted with your approval, <span className="font-semibold text-ok tabular-nums">{duration(took)}</span> after you hired {name}.</p>
          <Link href="/metrics" className="mt-1 inline-block text-xs text-accent hover:underline">See how that compares →</Link>
        </div>
      </div>
    </Ask>
  );
}

export function ExceptionCard({ inv, name, busy, onDecide, onView }: {
  inv: DeskInvoice; name: string; busy: string | null; onDecide: (d: "hold" | "reject" | "override", note?: string) => void; onView: () => void;
}) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const m = inv.match!, ex = inv.extraction!;
  const failing = m.exceptions;
  const draft = draftVendorQuery(name, inv.vendor, ex, m);
  return (
    <Ask tone="bad">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{ex.invoice_number} <span className="font-normal text-muted">· {inv.vendor.replace(/ Pvt Ltd$/, "")}</span></div>
          <div className="text-xs text-muted tabular-nums">{inr(ex.total)} · {inv.file.split("/").pop()}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">{failing.map((f) => <Badge key={f.id} tone="bad">{EXCEPTION_LABEL[f.exceptionType ?? ""] ?? f.label}</Badge>)}</div>
      </div>
      {failing.map((f) => (
        <div key={f.id} className="mt-2.5">
          <p className="text-sm leading-relaxed">{f.detail}</p>
          <Citations c={f} />
          {f.rule && <p className="mt-1 text-[11px] text-muted">Rule: {f.rule}</p>}
        </div>
      ))}

      <button onClick={() => setDraftOpen((o) => !o)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink">
        <Mail className="size-3.5" /> My draft to {inv.vendor.replace(/ Pvt Ltd$/, "")} <ChevronDown className={cx("size-3 transition-transform", draftOpen && "rotate-180")} />
      </button>
      {draftOpen && (
        <div className="animate-enter mt-1.5 rounded-md border border-line bg-gray-50 p-2.5 text-xs">
          <div className="font-medium">{draft.subject}</div>
          <pre className="mt-1.5 font-sans text-xs leading-relaxed whitespace-pre-wrap text-ink-2">{draft.body}</pre>
        </div>
      )}

      {overriding ? (
        <div className="animate-enter mt-3">
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why post it anyway? This goes in the audit trail."
            className="w-full rounded-md border border-line-2 bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" disabled={reason.trim().length < 5} loading={busy === `override:${inv.id}`} onClick={() => onDecide("override", reason)}>Post anyway</Button>
            <Button size="sm" variant="ghost" onClick={() => setOverriding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" loading={busy === `hold:${inv.id}`} onClick={() => onDecide("hold", "Query drafted to vendor")}>Hold &amp; queue my query</Button>
          <Button size="sm" onClick={() => setOverriding(true)}>Override &amp; post</Button>
          <Button size="sm" variant="ghost" loading={busy === `reject:${inv.id}`} onClick={() => onDecide("reject")}>Reject</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onView}><FileText className="size-3.5" /> View</Button>
        </div>
      )}
    </Ask>
  );
}

export function BatchCard({ invoices, busy, onApprove, onApproveAll }: {
  invoices: DeskInvoice[]; busy: string | null; onApprove: (id: string) => void; onApproveAll: () => void;
}) {
  const [open, setOpen] = useState(true);
  const total = invoices.reduce((s, i) => s + (i.total ?? 0), 0);
  return (
    <Ask>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{invoices.length} bill{invoices.length > 1 ? "s" : ""} ready to post</div>
          <div className="text-xs text-muted">All 3-way matched: price, quantity and receipt check out. <span className="tabular-nums">{inr(total)}</span> in total.</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-muted hover:text-ink" aria-label="Show bills"><ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} /></button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-line rounded-md border border-line">
          {invoices.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
              <Link href={`/employee/${i.id}`} className="min-w-0 flex-1 truncate hover:underline">
                <span className="font-medium">{i.number}</span> <span className="text-muted">· {i.vendor.replace(/ Pvt Ltd$/, "")} · {i.match?.poId}</span>
              </Link>
              <span className="tabular-nums">{inr(i.total ?? 0)}</span>
              <Button size="sm" variant="ghost" loading={busy === `approve:${i.id}`} onClick={() => onApprove(i.id)}>Post</Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="primary" className="mt-3 w-full" loading={busy === "approve-all"} onClick={onApproveAll}>
        <Check className="size-4" /> Approve &amp; post all {invoices.length}
      </Button>
    </Ask>
  );
}

export function SetupSummary({ desk, onUndo, busy }: { desk: DeskState; onUndo: (runId: string) => void; busy: boolean }) {
  const s = desk.sync;
  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-xs text-ink-2">
      <div className="mb-1.5 font-medium text-muted">Setup</div>
      <div className="flex justify-between py-0.5"><span>NetSuite {desk.connection?.accountId}</span><span className="text-ok">read-only</span></div>
      <div className="flex justify-between py-0.5"><span>{desk.mapping.total} fields mapped</span><Link href="/setup/mapping" className="text-accent hover:underline">Review all</Link></div>
      {s && s.status !== "undone" && s.summary && (
        <div className="flex items-center justify-between py-0.5">
          <span className="tabular-nums">Test sync {s.summary.ok}/{s.summary.total}</span>
          <span className="flex gap-3">
            <Link href="/setup/sync" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink className="size-3" /> Log</Link>
            <button disabled={busy} onClick={() => onUndo(s.id)} className="inline-flex items-center gap-1 text-muted hover:text-ink"><Undo2 className="size-3" /> Undo</button>
          </span>
        </div>
      )}
    </div>
  );
}
