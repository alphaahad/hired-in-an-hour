import { reverseAction } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok, bad } from "../../../_util";

export async function POST(_req: Request, ctx: RouteContext<"/api/actions/[id]/reverse">) {
  const { id } = await ctx.params;
  const w = await getWorkspace();
  const r = await reverseAction(w.id, id);
  return r.ok ? ok(r) : bad(r.error ?? "Could not reverse");
}
