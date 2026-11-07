import "server-only";
import { q, q1, json } from "./db";

export type Action = {
  id: string;
  workspace_id: string;
  ts: string;
  actor: "agent" | "human" | "system";
  type: string;
  target: string;
  summary: string;
  evidence: unknown;
  before: unknown;
  after: unknown;
  reversible: boolean;
  reversed_by: string | null;
  reverses: string | null;
};

export async function logAction(a: {
  ws: string;
  actor: Action["actor"];
  type: string;
  target: string;
  summary: string;
  evidence?: unknown;
  before?: unknown;
  after?: unknown;
  reversible?: boolean;
  reverses?: string;
}) {
  const id = "act_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await q(
    "insert into actions (id, workspace_id, actor, type, target, summary, evidence, before, after, reversible, reverses) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [id, a.ws, a.actor, a.type, a.target, a.summary, json(a.evidence ?? null), json(a.before ?? null), json(a.after ?? null), a.reversible ?? false, a.reverses ?? null],
  );
  if (a.reverses) await q("update actions set reversed_by = $2 where id = $1 and workspace_id = $3", [a.reverses, id, a.ws]);
  return id;
}

export const getAction = (ws: string, id: string) => q1<Action>("select * from actions where workspace_id = $1 and id = $2", [ws, id]);

export const listActions = (ws: string, target?: string) =>
  target
    ? q<Action>("select * from actions where workspace_id = $1 and target = $2 order by ts desc", [ws, target])
    : q<Action>("select * from actions where workspace_id = $1 order by ts desc limit 500", [ws]);

// ---- funnel events ----
export const FUNNEL = [
  { name: "setup_started", label: "Started setup" },
  { name: "erp_connected", label: "Connected NetSuite" },
  { name: "mappings_approved", label: "Approved field mappings" },
  { name: "test_sync_passed", label: "Test sync passed" },
  { name: "agent_started", label: "AP employee ran" },
  { name: "first_bill_posted", label: "First bill posted (working employee)" },
] as const;
export type FunnelEvent = (typeof FUNNEL)[number]["name"];

/** Funnel steps are recorded once per workspace; other events (undo, reversal...) every time. */
export async function track(ws: string, name: string, props: Record<string, unknown> = {}) {
  if (FUNNEL.some((f) => f.name === name)) {
    const exists = await q1("select 1 from events where workspace_id = $1 and name = $2", [ws, name]);
    if (exists) return false;
  }
  await q("insert into events (workspace_id, name, props) values ($1, $2, $3)", [ws, name, json(props)]);
  return true;
}
