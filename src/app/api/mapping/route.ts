import { getMappings, decideMapping } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";
import { targets, IGNORE } from "@/lib/mapping";
import { ok, bad, body } from "../_util";

export const maxDuration = 60;

export async function GET() {
  const w = await getWorkspace();
  if (!w.connection) return bad("Connect NetSuite first", 409);
  return ok({
    mappings: await getMappings(w.id),
    targets: targets.map(({ pattern, refersTo, ...t }) => ({ ...t, pattern: pattern?.source ?? null, refersTo: refersTo ?? null })),
    ignore: IGNORE,
  });
}

export async function POST(req: Request) {
  const w = await getWorkspace();
  const { sourceKey, target } = await body<{ sourceKey?: string; target?: string }>(req);
  if (!sourceKey || !target) return bad("sourceKey and target required");
  return ok(await decideMapping(w.id, sourceKey, target));
}
