"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader, api, cx } from "@/components/ui";
import { ActionLog, type ActionRow } from "@/components/ActionLog";

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "agent", label: "AP employee" },
  { key: "human", label: "People" },
  { key: "reversible", label: "Reversible now" },
] as const;

export default function Audit() {
  const [actions, setActions] = useState<ActionRow[] | null>(null);
  const [f, setF] = useState<(typeof FILTERS)[number]["key"]>("all");
  const load = useCallback(() => api<{ actions: ActionRow[] }>("/api/audit").then((r) => setActions(r.actions)), []);
  useEffect(() => { load(); }, [load]);

  const shown = (actions ?? []).filter((a) => f === "all" || (f === "reversible" ? a.reversible && !a.reversed_by : a.actor === f));
  const agent = actions?.filter((a) => a.actor === "agent").length ?? 0;
  const reversed = actions?.filter((a) => a.reversed_by).length ?? 0;

  return (
    <div className="animate-enter mx-auto max-w-4xl px-5 py-6">
      <PageHeader eyebrow="Trust layer" title="Audit trail">
        Every connection, mapping decision, sync, extraction, match, approval and reversal in this workspace, with its evidence and before/after state. Reversals are compensating entries: the original stays, struck through.
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <button key={x.key} onClick={() => setF(x.key)} className={cx("rounded-md border px-2.5 py-1 text-xs", f === x.key ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-2 hover:bg-gray-50")}>{x.label}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{actions?.length ?? 0} entries · {agent} by the employee · {reversed} reversed</span>
      </div>
      <Card>{actions ? <ActionLog actions={shown} onChange={load} showTarget /> : <div className="p-4 text-sm text-muted">Loading…</div>}</Card>
    </div>
  );
}
