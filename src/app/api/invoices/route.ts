import { listInvoices, latestSync } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { ok } from "../_util";

export async function GET() {
  const w = await getWorkspace();
  const sync = await latestSync(w.id);
  return ok({
    invoices: await listInvoices(w.id),
    syncReady: !!sync && sync.status !== "undone" && sync.status !== "running",
    llmConfigured: !!process.env.GEMINI_API_KEY,
  });
}
