"use client";
import { useEffect, useState } from "react";
import { Card, PageHeader, api, cx } from "@/components/ui";
import { duration } from "@/lib/format";

type Step = { name: string; label: string; count: number; conversionFromPrev: number | null; medianStepMs: number | null; medianFromStartMs: number | null };
type Data = {
  funnel: { sessions: number; steps: Step[]; timeToFirstEmployee: { median: number | null; p90: number | null; underHour: number; n: number } };
  other: { name: string; n: number }[];
  me: { setupStartedAt: string | null; firstEmployeeAt: string | null; internal: boolean };
  includeInternal: boolean;
};

const OTHER_LABEL: Record<string, string> = { sync_undone: "Test syncs undone", action_reversed: "Agent/human actions reversed" };

export default function Metrics() {
  const [d, setD] = useState<Data | null>(null);
  const [internal, setInternal] = useState(false);
  useEffect(() => { api<Data>(`/api/metrics${internal ? "?internal=1" : ""}`).then(setD); }, [internal]);

  if (!d) return <div className="mx-auto max-w-5xl px-5 py-6 text-sm text-muted">Loading…</div>;
  const f = d.funnel;
  const mine = d.me.setupStartedAt && d.me.firstEmployeeAt ? new Date(d.me.firstEmployeeAt).getTime() - new Date(d.me.setupStartedAt).getTime() : null;
  const top = f.steps[0]?.count || 1;
  const worst = f.steps.slice(1).filter((s) => s.conversionFromPrev !== null).sort((a, b) => a.conversionFromPrev! - b.conversionFromPrev!)[0];

  return (
    <div className="animate-enter mx-auto max-w-5xl px-5 py-6">
      <PageHeader
        eyebrow="Measurement"
        title="Time to first working employee"
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Include rehearsal sessions
          </label>
        }
      >
        Instrumented from real sessions of this demo: one session per workspace, from “Start setup” to the first approved bill. {d.me.internal && "This browser is marked as a rehearsal session and is excluded by default."}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Your run</div>
          <div className={cx("mt-1 font-mono text-2xl font-semibold", mine !== null && "text-ok")}>{mine !== null ? duration(mine) : d.me.setupStartedAt ? "in progress" : "not started"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Median, all sessions</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{f.timeToFirstEmployee.median !== null ? duration(f.timeToFirstEmployee.median) : "—"}</div>
          <div className="text-[11px] text-muted">n = {f.timeToFirstEmployee.n} completed</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">p90</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{f.timeToFirstEmployee.p90 !== null ? duration(f.timeToFirstEmployee.p90) : "—"}</div>
          <div className="text-[11px] text-muted">the number I&apos;d actually manage to</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Completed under 1 hour</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{f.timeToFirstEmployee.n ? `${Math.round((f.timeToFirstEmployee.underHour / f.timeToFirstEmployee.n) * 100)}%` : "—"}</div>
          <div className="text-[11px] text-muted">of {f.sessions} started sessions, {f.timeToFirstEmployee.n} finished</div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium">Setup funnel</div>
          {worst && worst.conversionFromPrev! < 1 && <div className="text-xs text-warn">Biggest drop-off: before “{worst.label}” ({Math.round(worst.conversionFromPrev! * 100)}% continue)</div>}
        </div>
        <div className="mt-4 space-y-2.5">
          {f.steps.map((s, i) => (
            <div key={s.name} className="grid grid-cols-[220px_1fr_150px_130px] items-center gap-3 text-sm">
              <div className="text-ink-2">{s.label}</div>
              <div className="h-6 overflow-hidden rounded bg-gray-100">
                {s.count > 0 && <div className={cx("animate-reveal flex h-full items-center rounded px-2 font-mono text-[11px] text-white", i === f.steps.length - 1 ? "bg-ok" : "bg-accent")} style={{ width: `${Math.max(4, (s.count / top) * 100)}%`, animationDelay: `${i * 70}ms` }}>{s.count}</div>}
              </div>
              <div className="text-xs text-muted">{i === 0 ? "—" : s.conversionFromPrev === null ? "—" : `${Math.round(s.conversionFromPrev * 100)}% from previous`}</div>
              <div className="text-right font-mono text-xs text-muted">{s.medianStepMs !== null ? `+${duration(s.medianStepMs)} median` : ""}</div>
            </div>
          ))}
        </div>
        {f.sessions === 0 && <p className="mt-4 text-sm text-muted">No sessions yet. Start setup to create the first one.</p>}
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm font-medium">Trust signals</div>
          <ul className="mt-2 space-y-1 text-sm">
            {d.other.length ? d.other.map((o) => <li key={o.name} className="flex justify-between"><span className="text-ink-2">{OTHER_LABEL[o.name] ?? o.name}</span><span className="font-mono">{o.n}</span></li>) : <li className="text-muted">None yet</li>}
          </ul>
          <p className="mt-2 text-xs text-muted">Undo and reversal usage is a leading indicator: high reversal rates mean people don&apos;t trust what the employee did.</p>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium">How to read this honestly</div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">
            <li>These are demo sessions on synthetic data, not customer onboardings. Real setups add credential procurement and IT approval, which this demo doesn&apos;t model.</li>
            <li>Each step counts once per workspace. “Reset demo” starts a new session, so abandoned runs show up as drop-off.</li>
            <li>The clock starts at “Start setup”, not at contract signature. In production I&apos;d also track signature → first login.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
