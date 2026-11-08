import "server-only";
import { cookies } from "next/headers";
import { q, q1, json } from "./db";

export type Workspace = {
  id: string;
  created_at: string;
  setup_started_at: string | null;
  first_employee_at: string | null;
  is_internal: boolean;
  employee_name: string | null;
  connection: { accountId: string; connectedAt: string; counts: Record<string, number> } | null;
};

export async function workspaceId() {
  const c = await cookies();
  const id = c.get("zws")?.value;
  if (!id) throw new Error("No workspace cookie");
  return { id, internal: c.get("zinternal")?.value === "1" };
}

export async function getWorkspace(): Promise<Workspace> {
  const { id, internal } = await workspaceId();
  await q("insert into workspaces (id, is_internal) values ($1, $2) on conflict (id) do update set is_internal = workspaces.is_internal or excluded.is_internal", [id, internal]);
  return (await q1<Workspace>("select * from workspaces where id = $1", [id]))!;
}

/** "Reset demo" = start a fresh workspace. The old one stays as its own row in the funnel. */
export async function rotateWorkspace() {
  const c = await cookies();
  const id = "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  c.set("zws", id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return id;
}

/** The name the user gave their AP employee. Plain text, 1–24 characters. */
export function cleanEmployeeName(raw: unknown): string | null {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 24) return null;
  if (!/^[\p{L}\p{N} .'-]+$/u.test(name)) return null;
  return name;
}

export async function setEmployeeName(id: string, name: string) {
  await q("update workspaces set employee_name = $2 where id = $1", [id, name]);
}

export async function setConnection(id: string, conn: Workspace["connection"]) {
  await q("update workspaces set connection = $2 where id = $1", [id, conn ? json(conn) : null]);
}
