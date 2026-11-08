"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FastForward, Pause, Play, Timer } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { duration } from "@/lib/format";
import { personaColour } from "@/lib/narrate";
import { Avatar } from "./Avatar";
import type { DeskState, Phase } from "./useDesk";

const ONBOARDING: Partial<Record<Phase, string>> = { connect: "1 of 3 · getting access", mapping: "2 of 3 · learning your fields", sync: "3 of 3 · test sync" };

export function EmployeeHeader(props: {
  desk: DeskState; phase: Phase; requests: number; working: boolean; paused: boolean; skipping: boolean;
  onPause: () => void; onResume: () => void; onSkip: () => void;
}) {
  const { desk, phase, requests, working, paused, skipping } = props;
  const name = desk.employee.name ?? "Your AP employee";
  const c = personaColour(name);
  const hired = desk.workspace.setupStartedAt ? new Date(desk.workspace.setupStartedAt).getTime() : null;
  const productive = desk.workspace.firstEmployeeAt ? new Date(desk.workspace.firstEmployeeAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hired || productive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hired, productive]);
  const elapsed = hired ? (productive ?? now) - hired : 0;
  const done = desk.invoices.filter((i) => i.status !== "queued").length;

  let status: { text: string; tone: "accent" | "ok" | "warn" | "muted" };
  if (ONBOARDING[phase]) status = { text: `Onboarding · ${ONBOARDING[phase]}`, tone: "accent" };
  else if (phase === "working" && paused) status = { text: `Paused · ${done} of 20 read`, tone: "warn" };
  else if (phase === "working" || working) status = { text: `Working · ${done} of 20 read`, tone: "ok" };
  else if (requests) status = { text: `Waiting on you · ${requests}`, tone: "warn" };
  else status = { text: "All caught up", tone: "muted" };

  return (
    <div className="rounded-xl border border-line bg-surface p-4" style={{ boxShadow: `inset 3px 0 0 ${c.bg}` }}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size={44} working={status.tone === "ok"} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            <span className="text-sm text-muted">AP Specialist</span>
          </div>
          <div className={cx("mt-0.5 inline-flex items-center gap-1.5 text-sm",
            status.tone === "ok" && "text-ok", status.tone === "warn" && "text-warn", status.tone === "accent" && "text-accent", status.tone === "muted" && "text-muted")}>
            <span className={cx("size-1.5 rounded-full bg-current", status.tone === "ok" && "presence-pulse")} />
            {status.text}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {phase === "working" && (paused
            ? <Button size="sm" onClick={props.onResume}><Play className="size-3.5" /> Resume</Button>
            : <>
                <Button size="sm" onClick={props.onPause}><Pause className="size-3.5" /> Pause</Button>
                <Button size="sm" variant="ghost" disabled={skipping} onClick={props.onSkip} title="Finish the rest without narrating each step">
                  <FastForward className="size-3.5" /> {skipping ? "Skipping…" : "Skip ahead"}
                </Button>
              </>)}
          <div className="ml-2 border-l border-line pl-4 text-right">
            <div className="flex items-center justify-end gap-1 text-[11px] text-muted"><Timer className="size-3" /> {productive ? "Hired to productive" : "Since hired"}</div>
            <div className={cx("text-2xl leading-tight font-semibold tracking-tight tabular-nums", productive ? "text-ok" : "text-ink")}>{hired ? duration(elapsed) : "0s"}</div>
            <div className="text-[11px] text-muted">{productive ? <Link href="/metrics" className="text-accent hover:underline">See the metric</Link> : "target under 60m"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
