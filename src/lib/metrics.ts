import "server-only";
import { q } from "./db";
import { FUNNEL } from "./audit";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Funnel over real demo sessions. Rehearsal sessions (is_internal) are excluded unless asked for. */
export async function funnel(includeInternal: boolean) {
  const rows = await q<{ workspace_id: string; name: string; ts: string }>(
    `select e.workspace_id, e.name, e.ts from events e join workspaces w on w.id = e.workspace_id
     where ($1 or not w.is_internal) and e.name = any($2::text[])`,
    [includeInternal, FUNNEL.map((f) => f.name)],
  );
  const byWs = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byWs.has(r.workspace_id)) byWs.set(r.workspace_id, new Map());
    byWs.get(r.workspace_id)!.set(r.name, new Date(r.ts).getTime());
  }
  const sessions = [...byWs.values()].filter((m) => m.has("setup_started"));
  const steps = FUNNEL.map((f, i) => {
    const reached = sessions.filter((m) => m.has(f.name));
    const prev = i === 0 ? sessions : sessions.filter((m) => m.has(FUNNEL[i - 1].name));
    const stepTimes = i === 0 ? [] : reached.filter((m) => m.has(FUNNEL[i - 1].name)).map((m) => m.get(f.name)! - m.get(FUNNEL[i - 1].name)!);
    return {
      name: f.name, label: f.label, count: reached.length,
      conversionFromPrev: prev.length ? reached.length / prev.length : null,
      medianStepMs: median(stepTimes.filter((x) => x >= 0)),
      medianFromStartMs: median(reached.map((m) => m.get(f.name)! - m.get("setup_started")!)),
    };
  });
  const done = sessions.filter((m) => m.has("first_bill_posted")).map((m) => m.get("first_bill_posted")! - m.get("setup_started")!);
  return {
    sessions: sessions.length,
    steps,
    timeToFirstEmployee: { median: median(done), p90: done.length ? [...done].sort((a, b) => a - b)[Math.min(done.length - 1, Math.floor(done.length * 0.9))] : null, underHour: done.filter((d) => d < 3600_000).length, n: done.length },
  };
}

export async function otherEvents(includeInternal: boolean) {
  return q<{ name: string; n: number }>(
    `select e.name, count(*)::int as n from events e join workspaces w on w.id = e.workspace_id
     where ($1 or not w.is_internal) and not (e.name = any($2::text[])) group by e.name order by n desc`,
    [includeInternal, FUNNEL.map((f) => f.name)],
  );
}
