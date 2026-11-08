import { deskState } from "@/lib/service";
import { ok } from "../_util";

export const maxDuration = 60;

export async function GET() {
  return ok(await deskState());
}
