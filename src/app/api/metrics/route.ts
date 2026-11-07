import { funnel, otherEvents } from "@/lib/metrics";
import { checklist } from "@/lib/service";
import type { NextRequest } from "next/server";
import { ok } from "../_util";

export async function GET(req: NextRequest) {
  const includeInternal = req.nextUrl.searchParams.get("internal") === "1";
  const [f, other, me] = await Promise.all([funnel(includeInternal), otherEvents(includeInternal), checklist()]);
  return ok({ funnel: f, other, me: me.workspace, includeInternal });
}
