"use client";
import { useState } from "react";
import { Bot, ChevronRight, Cog, Undo2, User } from "lucide-react";
import { Badge, Button, cx, api, refreshState } from "./ui";

export type ActionRow = {
  id: string; ts: string; actor: "agent" | "human" | "system"; type: string; target: string; summary: string;
  evidence: unknown; before: unknown; after: unknown; reversible: boolean; reversed_by: string | null; reverses: string | null;
};

const ACTOR = {
  agent: { icon: Bot, label: "AP employee", cls: "bg-accent-soft text-accent" },
  human: { icon: User, label: "You", cls: "bg-gray-100 text-ink-2" },
  system: { icon: Cog, label: "System", cls: "bg-gray-100 text-muted" },
};

export function ActionLog({ actions, onChange, showTarget }: { actions: ActionRow[]; onChange: () => void; showTarget?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!actions.length) return <div className="px-4 py-6 text-sm text-muted">Nothing yet.</div>;
  return (
    <div>
      {err && <div className="px-4 pt-3 text-sm text-bad">{err}</div>}
      <ol>
        {actions.map((a) => {
          const A = ACTOR[a.actor];
          const hasDetail = !!(a.evidence || a.before || a.after);
          const isOpen = open.has(a.id);
          return (
            <li key={a.id} className={cx("border-t border-line px-4 py-3 first:border-t-0", a.reversed_by && "bg-gray-50/70")}>
              <div className="flex items-start gap-3">
                <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", A.cls)} title={A.label}><A.icon className="size-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span className="font-medium text-ink-2">{A.label}</span>
                    <span>{new Date(a.ts).toLocaleTimeString("en-GB")}</span>
                    <span className="font-mono">{a.type}</span>
                    {showTarget && <span className="font-mono">{a.target}</span>}
                    {a.reversed_by && <Badge>reversed</Badge>}
                    {a.reverses && <Badge tone="warn">reversal</Badge>}
                  </div>
                  <p className={cx("mt-0.5 text-sm", a.reversed_by ? "text-muted line-through decoration-gray-500" : "text-ink")}>{a.summary}</p>
                  {hasDetail && (
                    <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink">
                      <ChevronRight className={cx("size-3 transition-transform", isOpen && "rotate-90")} /> Evidence and before/after
                    </button>
                  )}
                  {isOpen && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-50 p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
                      {JSON.stringify({ evidence: a.evidence ?? undefined, before: a.before ?? undefined, after: a.after ?? undefined }, null, 2)}
                    </pre>
                  )}
                </div>
                {a.reversible && !a.reversed_by && (
                  <Button
                    size="sm"
                    loading={busy === a.id}
                    onClick={async () => {
                      setBusy(a.id); setErr(null);
                      try {
                        await api(`/api/actions/${a.id}/reverse`, { json: {} });
                        onChange();
                        refreshState();
                      } catch (e) {
                        setErr((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Undo2 className="size-3.5" /> Reverse
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
