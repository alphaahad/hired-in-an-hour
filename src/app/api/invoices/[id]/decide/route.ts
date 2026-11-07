import { decideInvoice, type Decision } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok, bad, body } from "../../../_util";

export async function POST(req: Request, ctx: RouteContext<"/api/invoices/[id]/decide">) {
  const { id } = await ctx.params;
  const { decision, note } = await body<{ decision?: Decision; note?: string }>(req);
  if (!decision || !["approve", "hold", "reject", "override"].includes(decision)) return bad("Invalid decision");
  const w = await getWorkspace();
  const r = await decideInvoice(w.id, id, decision, note ?? "");
  return r.ok ? ok(r) : bad(r.error);
}
