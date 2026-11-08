import { startSetup, checklist } from "@/lib/service";
import { cleanEmployeeName } from "@/lib/workspace";
import { ok, body } from "../../_util";

export async function POST(req: Request) {
  const { name } = await body<{ name?: string }>(req);
  return ok(await checklist(await startSetup(cleanEmployeeName(name))));
}
