import { getWorkspace, cleanEmployeeName, setEmployeeName } from "@/lib/workspace";
import { ok, bad, body } from "../_util";

export async function POST(req: Request) {
  const { name } = await body<{ name?: string }>(req);
  const clean = cleanEmployeeName(name);
  if (!clean) return bad("Use 1–24 letters, numbers, spaces, dots, hyphens or apostrophes.");
  const w = await getWorkspace();
  await setEmployeeName(w.id, clean);
  return ok({ name: clean });
}
