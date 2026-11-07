import { NextResponse, type NextRequest } from "next/server";

// Every visitor gets an isolated demo workspace (no auth: deliberately cut).
// `?internal=1` marks the browser as mine so rehearsals stay out of the funnel.
export function proxy(req: NextRequest) {
  let res: NextResponse;
  if (!req.cookies.get("zws")) {
    const id = "ws_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    req.cookies.set("zws", id); // visible to the page/route rendering this same request
    res = NextResponse.next({ request: { headers: req.headers } });
    res.cookies.set("zws", id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  } else {
    res = NextResponse.next();
  }
  const flag = req.nextUrl.searchParams.get("internal");
  if (flag === "1") res.cookies.set("zinternal", "1", { maxAge: 60 * 60 * 24 * 365, path: "/" });
  if (flag === "0") res.cookies.delete("zinternal");
  return res;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|mock-invoices/).*)"] };
