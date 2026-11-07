import { undoSync } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok, bad, body } from "../../_util";

export async function POST(req: Request) {
  const w = await getWorkspace();
  const { runId } = await body<{ runId?: string }>(req);
  if (!runId) return bad("runId required");
  const r = await undoSync(w.id, runId);
  return r.ok ? ok(r) : bad(r.error ?? "Undo failed");
}
