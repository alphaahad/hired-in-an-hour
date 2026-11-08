"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertOctagon, CircleAlert, CircleCheck, Info, Loader2, PartyPopper } from "lucide-react";
import { cx } from "@/components/ui";
import { personaColour, type FeedLine, type LiveStep } from "@/lib/narrate";
import { Avatar } from "./Avatar";
import type { Live } from "./useDesk";

const time = (ts: string) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const STEP_ICON: Record<LiveStep["status"], React.ReactNode> = {
  doing: <Loader2 className="size-3.5 animate-spin text-muted" />,
  info: <Info className="size-3.5 text-muted" />,
  pass: <CircleCheck className="size-3.5 text-ok" />,
  warn: <CircleAlert className="size-3.5 text-warn" />,
  fail: <AlertOctagon className="size-3.5 text-bad" />,
};

export function WorkFeed({ name, lines, live, thinking }: { name: string; lines: FeedLine[]; live: Live | null; thinking: string | null }) {
  const list = useRef<HTMLOListElement>(null);
  const c = personaColour(name);
  const count = lines.length + (live?.shown ?? 0);
  // Scroll the log itself, never the page: the rest of the desk must stay where you left it.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, thinking, live?.invoiceId]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-sm font-medium">{name}&apos;s work log</div>
        <Link href="/audit" className="text-xs text-muted hover:text-ink">Full audit trail</Link>
      </div>
      <ol ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lines.map((l) => (
          <li key={l.id} className="animate-enter flex gap-2.5">
            {l.who === "employee" ? <Avatar name={name} size={24} /> : <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gray-100 text-[10px] font-semibold text-ink-2">You</span>}
            <div className={cx("min-w-0 flex-1 rounded-lg px-3 py-2 text-sm leading-relaxed",
              l.tone === "celebrate" ? "border border-emerald-200 bg-ok-soft" : l.who === "you" ? "bg-gray-50 text-ink-2" : "")}
              style={l.who === "employee" && l.tone !== "celebrate" ? { background: c.soft } : undefined}>
              {l.tone === "celebrate" && <PartyPopper className="mr-1.5 mb-0.5 inline size-4 text-ok" />}
              <span className={cx(l.tone === "bad" && "text-bad")}>{l.text}</span>
              <div className="mt-0.5 flex gap-2 text-[11px] text-muted">
                <span className="tabular-nums">{time(l.ts)}</span>
                {l.href && <Link href={l.href} className="hover:text-ink hover:underline">Open</Link>}
              </div>
            </div>
          </li>
        ))}

        {thinking && (
          <li className="animate-enter flex gap-2.5">
            <Avatar name={name} size={24} working />
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-2" style={{ background: c.soft }}>
              <Loader2 className="size-3.5 animate-spin" /> {thinking}
            </div>
          </li>
        )}

        {live && (
          <li className="animate-enter flex gap-2.5">
            <Avatar name={name} size={24} working />
            <div className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm" style={{ borderColor: c.bg + "33", background: c.soft }}>
              <div className="mb-1.5 flex items-center gap-2 font-medium" style={{ color: c.ink }}>
                {live.reading || live.shown < live.steps.length ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {live.reading ? `Reading ${live.file}…` : `Working on ${live.file}`}
              </div>
              <ul className="space-y-1">
                {live.steps.slice(0, live.shown).map((s, i) => (
                  <li key={i} className="animate-enter flex gap-2 text-[13px] leading-snug">
                    <span className="mt-0.5">{STEP_ICON[s.status]}</span>
                    <span className={cx(s.status === "fail" ? "font-medium text-bad" : s.status === "warn" ? "text-warn" : "text-ink-2")}>{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
