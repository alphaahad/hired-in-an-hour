import { checklist } from "@/lib/service";
import { ok } from "../_util";

export async function GET() {
  return ok(await checklist());
}
