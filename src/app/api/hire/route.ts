import { startSetup } from "@/lib/service";
import { cleanEmployeeName } from "@/lib/workspace";

// A plain HTML form posts here, so hiring works even before the page's JavaScript has loaded.
export async function POST(req: Request) {
  const form = await req.formData();
  const name = cleanEmployeeName(form.get("name"));
  const to = new URL(name ? "/desk" : "/?error=name", req.url);
  if (name) await startSetup(name);
  return Response.redirect(to, 303);
}
