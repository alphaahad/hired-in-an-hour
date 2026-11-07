import { connectErp } from "@/lib/service";
import { ok, bad, body } from "../../_util";

export async function POST(req: Request) {
  const { accountId = "", token = "" } = await body<{ accountId?: string; token?: string }>(req);
  const res = await connectErp(accountId, token);
  return res.ok ? ok(res) : bad(res.error, 401);
}
