import { processInvoice } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok, bad, body } from "../../_util";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { invoiceId, forceLive } = await body<{ invoiceId?: string; forceLive?: boolean }>(req);
  if (!invoiceId) return bad("invoiceId required");
  const w = await getWorkspace();
  const r = await processInvoice(w.id, invoiceId, !!forceLive);
  return r.ok ? ok(r) : bad(r.error, 409);
}
