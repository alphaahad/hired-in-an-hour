import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { Desk } from "./Desk";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const w = await getWorkspace();
  // No hire, no desk: the clock starts when you hire someone.
  if (!w.employee_name || !w.setup_started_at) redirect("/");
  return <Desk />;
}
