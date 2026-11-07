"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Timer } from "lucide-react";
import { useChecklist } from "./useChecklist";
import { cx } from "./ui";
import { duration } from "@/lib/format";

const TARGET_MS = 60 * 60 * 1000;

/** A completed step's tick. It settles in only if this rail saw the step unfinished, i.e. you just completed it. */
function Tick({ fresh }: { fresh: boolean }) {
  return <Check className={cx("size-3", fresh && "animate-settle")} strokeWidth={3} />;
}

/** The metric, always visible: time from "Start setup" to the first approved bill. */
export function Rail() {
  const { state } = useChecklist();
  const path = usePathname();
  const [now, setNow] = useState(() => Date.now());
  const started = state?.workspace.setupStartedAt ? new Date(state.workspace.setupStartedAt).getTime() : null;
  const finished = state?.workspace.firstEmployeeAt ? new Date(state.workspace.firstEmployeeAt).getTime() : null;

  useEffect(() => {
    if (!started || finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [started, finished]);

  const elapsed = started ? (finished ?? now) - started : 0;
  const pctOfTarget = Math.min(1, elapsed / TARGET_MS);
  const nextIdx = state?.steps.findIndex((s) => !s.done) ?? 0;

  // Remember steps seen unfinished (React's "adjust state during render" pattern; no effect, no ref).
  const [seenPending, setSeenPending] = useState<ReadonlySet<string>>(() => new Set());
  const pending = state?.steps.filter((s) => !s.done).map((s) => s.key) ?? [];
  if (pending.some((k) => !seenPending.has(k))) setSeenPending(new Set([...seenPending, ...pending]));

  return (
    <aside className="w-72 shrink-0">
      <div className="sticky top-16 space-y-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Timer className="size-3.5" /> Time to first working employee
          </div>
          <div className={cx("mt-1.5 font-mono text-3xl font-semibold tracking-tight", finished ? "text-ok" : "text-ink")}>
            {started ? duration(elapsed) : "0s"}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className={cx("h-full rounded-full transition-[width,background-color] duration-700 ease-(--ease-spring)", finished ? "bg-ok" : pctOfTarget > 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.max(2, pctOfTarget * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted">
            <span>{finished ? "Done. Timer stopped" : started ? "Running" : "Starts when you begin setup"}</span>
            <span>Target 1h</span>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-2">
          <div className="px-2 pt-1.5 pb-2 text-xs font-medium text-muted">First-hour checklist</div>
          <ol className="space-y-0.5">
            {(state?.steps ?? []).map((s, i) => {
              const active = path === s.href || (s.href === "/employee" && path.startsWith("/employee") && i === nextIdx);
              return (
                <li key={s.key}>
                  <Link href={s.href} className={cx("pressable flex gap-2.5 rounded-md px-2 py-2", active ? "bg-accent-soft" : "hover:bg-gray-50")}>
                    <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold transition-colors duration-300",
                      s.done ? "border-ok bg-ok text-white" : i === nextIdx ? "border-accent text-accent" : "border-line-2 text-muted")}>
                      {s.done ? <Tick fresh={seenPending.has(s.key)} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cx("block text-sm", s.done ? "text-ink-2" : i === nextIdx ? "font-medium text-ink" : "text-ink-2")}>{s.label}</span>
                      <span className="block truncate text-xs text-muted">{s.detail}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="px-1 text-[11px] leading-relaxed text-muted">
          Everything here runs on a mock NetSuite sandbox with synthetic vendors, POs and invoices.
        </p>
      </div>
    </aside>
  );
}

export function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1400px] gap-6 px-5 py-6">
      <Rail />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
