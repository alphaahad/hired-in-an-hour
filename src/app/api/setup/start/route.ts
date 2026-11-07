import { startSetup, checklist } from "@/lib/service";
import { ok } from "../../_util";

export async function POST() {
  return ok(await checklist(await startSetup()));
}
