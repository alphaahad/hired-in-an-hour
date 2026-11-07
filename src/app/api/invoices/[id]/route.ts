import { getInvoice } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok, bad } from "../../_util";

export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;
  const w = await getWorkspace();
  const inv = await getInvoice(w.id, id);
  return inv ? ok(inv) : bad("Not found", 404);
}
