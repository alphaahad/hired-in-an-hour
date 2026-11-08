"use client";
import { useEffect, useMemo } from "react";
import { ErrorNote } from "@/components/ui";
import { feedFromActions } from "@/lib/narrate";
import { useDesk } from "@/components/desk/useDesk";
import { EmployeeHeader } from "@/components/desk/EmployeeHeader";
import { WorkFeed } from "@/components/desk/WorkFeed";
import { DocumentViewer, loadPdfJs } from "@/components/desk/DocumentViewer";
import { BatchCard, CelebrationCard, ConnectCard, ExceptionCard, MappingQuestion, SetupSummary, SyncCard } from "@/components/desk/Requests";

export function Desk() {
  const d = useDesk();
  const { desk, phase, live } = d;
  // Load the PDF renderer while onboarding happens, so the first invoice opens instantly.
  useEffect(() => { void loadPdfJs(); }, []);

  const lines = useMemo(() => {
    if (!desk?.employee.name) return [];
    const byId = new Map(desk.invoices.map((i) => [i.id, i]));
    return feedFromActions(desk.actions, {
      name: desk.employee.name,
      hiredAt: desk.workspace.setupStartedAt,
      mapping: desk.mapping.total ? { auto: desk.mapping.auto, total: desk.mapping.total, review: desk.mapping.review } : undefined,
      invoice: (id) => {
        const i = byId.get(id);
        return i && { id, vendor: i.vendor, number: i.number, total: i.total, poId: i.match?.poId ?? null, receiptIds: i.match?.receiptIds ?? [] };
      },
    });
  }, [desk]);

  if (!desk) return <div className="mx-auto max-w-[1400px] px-5 py-6 text-sm text-muted">{d.err ?? "Opening the desk…"}</div>;
  const name = desk.employee.name ?? "Your AP employee";

  const exceptions = desk.invoices.filter((i) => i.status === "exception" && i.match && i.extraction);
  const matched = desk.invoices.filter((i) => i.status === "matched");
  const requests = (phase === "connect" ? 1 : 0) + desk.mapping.pending.length + exceptions.length + (matched.length ? 1 : 0);
  const thinking = d.busy === "connect" ? "Looking around your NetSuite and learning your fields…"
    : phase === "working" && !live && !d.paused ? "Picking up the next invoice…" : null;

  // Which document is on screen: whatever it's reading now, else whatever you asked to see.
  const docId = live?.invoiceId ?? d.focusDoc;
  const doc = docId ? desk.invoices.find((i) => i.id === docId) : null;
  // Highlights: while reading, everything narrated so far; when you open an exception, the values it cited.
  const shownSteps = live ? live.steps.slice(0, live.shown) : [];
  const failCites = (inv: typeof doc) =>
    inv?.match?.exceptions.flatMap((e) => e.citations.filter((c) => c.doc.startsWith("Invoice")).map((c) => c.value)) ?? [];
  const highlights = live
    ? shownSteps.flatMap((s) => s.highlight ?? [])
    : [...failCites(doc), ...(doc?.extraction ? [doc.extraction.evidence?.po_number ?? ""].filter(Boolean) : [])];
  const failing = live
    ? shownSteps.filter((s) => s.status === "fail").flatMap((s) => s.highlight ?? [])
    : failCites(doc);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-5 py-5">
      <EmployeeHeader desk={desk} phase={phase} requests={requests} working={!!live} paused={d.paused} skipping={d.skipping}
        onPause={d.pause} onResume={d.resume} onSkip={d.skipAhead} />
      {d.err && <div onClick={d.dismissError}><ErrorNote>{d.err}</ErrorNote></div>}

      {/* While a document is open it sits beside the narration, so you can watch the employee read it. */}
      <div className={doc ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_370px]" : "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]"}>
        <div className="h-[calc(100vh-13rem)] min-h-[440px]">
          <WorkFeed name={name} lines={lines} live={live} thinking={thinking} />
        </div>
        {doc && (
          <div className="h-[calc(100vh-13rem)] min-h-[440px]">
            <DocumentViewer key={doc.id} file={doc.file} title={`${live ? "Reading" : "Viewing"} ${doc.file.split("/").pop()}`} highlights={highlights} failing={failing} onClose={live ? undefined : () => d.setFocusDoc(null)} />
          </div>
        )}

        <aside className="space-y-3 lg:sticky lg:top-16">
          <div className="flex items-baseline justify-between px-1">
            <div className="text-sm font-semibold">Needs you</div>
            <div className="text-xs text-muted">{requests ? `${requests} open` : "nothing right now"}</div>
          </div>

          {phase === "connect" && <ConnectCard busy={d.busy === "connect"} onGrant={d.connect} />}
          {phase === "mapping" && (
            <>
              <p className="px-1 text-xs text-muted">{desk.mapping.pending.length} question{desk.mapping.pending.length > 1 ? "s" : ""} before I can start. Everything else I mapped myself.</p>
              {desk.mapping.pending.map((m) => (
                <MappingQuestion key={m.source_key} m={m} targets={desk.mapping.targets} ignore={desk.mapping.ignore}
                  busy={d.busy === `map:${m.source_key}`} onDecide={(t) => d.decideMapping(m.source_key, t)} />
              ))}
            </>
          )}
          {phase === "sync" && <SyncCard sync={d.sync} undone={desk.sync?.status === "undone"} onSyncAgain={d.syncAgain} />}

          {desk.workspace.firstEmployeeAt && <CelebrationCard name={name} desk={desk} />}
          {exceptions.map((i) => (
            <ExceptionCard key={i.id} inv={i} name={name} busy={d.busy} onView={() => d.setFocusDoc(i.id)}
              onDecide={(dec, note) => d.decide(i.id, dec, note)} />
          ))}
          {matched.length > 0 && (
            <BatchCard invoices={matched} busy={d.busy} onApprove={(id) => d.decide(id, "approve")} onApproveAll={() => d.approveAll(matched.map((m) => m.id))} />
          )}
          {(phase === "working" || phase === "caught_up") && requests === 0 && (
            <div className="rounded-xl border border-dashed border-line-2 p-4 text-sm text-muted">Nothing needs you right now. I&apos;ll bring you anything I&apos;m not sure about.</div>
          )}
          {desk.connection && phase !== "connect" && phase !== "mapping" && <SetupSummary desk={desk} busy={d.busy === "undo"} onUndo={d.undoSync} />}
        </aside>
      </div>
    </div>
  );
}
