import { listActions } from "@/lib/audit";
import { getWorkspace } from "@/lib/workspace";
import { ok } from "../_util";

export async function GET() {
  const w = await getWorkspace();
  return ok({ actions: await listActions(w.id) });
}
