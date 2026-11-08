"use client";
// The Desk's conductor. It reads the real state (/api/desk) and decides what the employee does
// next: ask for access, ask about fields, run the test sync, work the queue. Every step calls the
// existing APIs; the only thing added here is pacing, so a person can follow the work.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionRow } from "@/components/ActionLog";
import { api, refreshState } from "@/components/ui";
import { liveSteps, type LiveStep } from "@/lib/narrate";
import type { Extraction, MatchResult } from "@/lib/types";

export type PendingMapping = {
  source_key: string; target: string | null; confidence: number; method: string; reason: string; status: string;
  llm_source: "live" | "cached" | "fallback" | null;
  source: { key: string; record: string; field: string; type: string; samples: string[] };
};
export type DeskInvoice = {
  id: string; file: string; vendor: string; vendorId: string | null; number: string | null; total: number | null;
  status: "queued" | "processing" | "matched" | "exception" | "posted" | "on_hold" | "rejected";
  match: MatchResult | null; extraction: Extraction | null; extraction_source: "live" | "cached" | "fallback" | null; bill_id: string | null;
};
export type SyncSummary = { total: number; ok: number; failed: number; failures: { type: string; id: string; error: string }[] };
export type DeskState = {
  employee: { name: string | null };
  workspace: { internal: boolean; setupStartedAt: string | null; firstEmployeeAt: string | null; now: string };
  connection: { accountId: string; connectedAt: string; counts: Record<string, number> } | null;
  mapping: { total: number; auto: number; review: number; pending: PendingMapping[]; targets: { key: string; label: string; record: string }[]; ignore: string };
  sync: { id: string; status: string; summary: SyncSummary | null } | null;
  invoices: DeskInvoice[];
  actions: ActionRow[];
};

export type Phase = "loading" | "connect" | "mapping" | "sync" | "working" | "caught_up";
export type Live = { invoiceId: string; file: string; steps: LiveStep[]; shown: number; reading: boolean };
export type SyncProgress = { ok: number; failed: number; total: number; lines: { level: string; msg: string }[]; running: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEP_MS = 330; // per narrated check: slow enough to follow, fast enough for a 2-minute demo
const FIRST_STEP_MS = 550;
const BETWEEN_MS = 650;
const TOTAL_RECORDS = 78;

export function phaseOf(d: DeskState | null): Phase {
  if (!d) return "loading";
  if (!d.connection) return "connect";
  if (d.mapping.pending.length) return "mapping";
  if (!d.sync || d.sync.status === "undone" || d.sync.status === "running") return "sync";
  if (d.invoices.some((i) => i.status === "queued")) return "working";
  return "caught_up";
}

export function useDesk() {
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [paused, setPaused] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [sync, setSync] = useState<SyncProgress | null>(null);
  const [focusDoc, setFocusDoc] = useState<string | null>(null);

  const deskRef = useRef<DeskState | null>(null);
  const pausedRef = useRef(false);
  const skipRef = useRef(false);
  const workingRef = useRef(false);
  const syncingRef = useRef(false);

  const apply = useCallback((d: DeskState) => {
    deskRef.current = d;
    setDesk(d);
    refreshState();
    return d;
  }, []);
  const load = useCallback(() => api<DeskState>("/api/desk").then(apply), [apply]);

  // ---- the test sync, streamed ----
  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSync({ ok: 0, failed: 0, total: TOTAL_RECORDS, lines: [], running: true });
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
        for (const p of parts.filter(Boolean)) {
          const line = JSON.parse(p);
          if (line.done) continue;
          setSync((s) => s && {
            ...s,
            ok: s.ok + (line.level === "ok" && line.record ? 1 : 0),
            failed: s.failed + (line.level === "warn" ? 1 : 0),
            lines: [...s.lines, { level: line.level, msg: line.msg }],
          });
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      syncingRef.current = false;
      setSync((s) => s && { ...s, running: false });
      await drive(await load());
    }
    // drive is defined below and stable; listing it would create a cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // ---- working the queue, one invoice at a time ----
  const work = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      for (;;) {
        if (pausedRef.current) break;
        const next = deskRef.current?.invoices.find((i) => i.status === "queued");
        if (!next) break;
        const file = next.file.split("/").pop()!;
        setLive({ invoiceId: next.id, file, steps: [], shown: 0, reading: true });
        const t0 = performance.now();
        const r = await api<{ row: { extraction: Extraction; match: MatchResult }; source: string | null }>("/api/agent/process", { json: { invoiceId: next.id } });
        const steps = liveSteps(file, r.row.extraction, r.row.match, { source: r.source, ms: performance.now() - t0 });
        setLive({ invoiceId: next.id, file, steps, shown: skipRef.current ? steps.length : 0, reading: false });
        if (!skipRef.current) {
          for (let i = 1; i <= steps.length; i++) {
            await sleep(i === 1 ? FIRST_STEP_MS : STEP_MS);
            if (skipRef.current) break;
            setLive((l) => (l && l.invoiceId === next.id ? { ...l, shown: i } : l));
          }
          await sleep(skipRef.current ? 0 : BETWEEN_MS);
        }
        await load();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      workingRef.current = false;
      setLive(null);
      setSkipping(false);
      skipRef.current = false;
      await load();
    }
  }, [load]);

  /** Decide what happens next on its own: the employee doesn't wait to be told to sync or to start. */
  const drive = useCallback(async (d: DeskState) => {
    const p = phaseOf(d);
    if (p === "sync" && !d.sync && !syncingRef.current) void runSync();
    if (p === "working" && !pausedRef.current && !workingRef.current) void work();
  }, [runSync, work]);

  useEffect(() => {
    api<DeskState>("/api/desk")
      .then((d) => drive(apply(d)))
      .catch((e) => setErr((e as Error).message));
  }, [apply, drive]);

  async function act<T>(key: string, fn: () => Promise<T>) {
    setBusy(key); setErr(null);
    try {
      const r = await fn();
      await drive(await load());
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  return {
    desk, err, busy, live, paused, skipping, sync, focusDoc,
    phase: phaseOf(desk),
    setFocusDoc,
    dismissError: () => setErr(null),
    connect: () => act("connect", () => api("/api/erp/connect", { json: { accountId: "TSTDRV2026417", token: "nsk_sandbox_demo_readonly" } })),
    decideMapping: (sourceKey: string, target: string) => act(`map:${sourceKey}`, () => api("/api/mapping", { json: { sourceKey, target } })),
    syncAgain: () => { void runSync(); },
    undoSync: (runId: string) => act("undo", () => api("/api/sync/undo", { json: { runId } })),
    decide: (invoiceId: string, decision: "approve" | "hold" | "reject" | "override", note = "") =>
      act(`${decision}:${invoiceId}`, () => api<{ firstEmployee?: boolean }>(`/api/invoices/${invoiceId}/decide`, { json: { decision, note } })),
    approveAll: (ids: string[]) => act("approve-all", async () => {
      for (const id of ids) await api(`/api/invoices/${id}/decide`, { json: { decision: "approve", note: "" } });
    }),
    pause: () => { pausedRef.current = true; setPaused(true); },
    resume: () => { pausedRef.current = false; setPaused(false); void work(); },
    skipAhead: () => { skipRef.current = true; setSkipping(true); },
  };
}
