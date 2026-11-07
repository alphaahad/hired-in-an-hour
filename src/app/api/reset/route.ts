import { rotateWorkspace } from "@/lib/workspace";
import { ok } from "../_util";

export async function POST() {
  return ok({ workspace: await rotateWorkspace() });
}
