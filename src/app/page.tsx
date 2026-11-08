import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { initials, personaColour } from "@/lib/narrate";

export const dynamic = "force-dynamic";

const WILL = [
  "Read every invoice PDF in the AP inbox",
  "Match each one against its purchase order and goods receipt",
  "Stop and show you the evidence when something doesn't add up",
  "Draft the query to the vendor so you don't have to",
];
const WONT = ["Post a bill to NetSuite without your approval", "Write anything to NetSuite while it's onboarding"];

export default async function Hire({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const w = await getWorkspace();
  const hired = w.employee_name && w.setup_started_at ? w.employee_name : null;
  const c = hired ? personaColour(hired) : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div>
        <div className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Onboarding prototype · AP digital employee</div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">Hire an AP employee. Have it posting bills within the hour.</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">
          A digital employee only creates value once it&apos;s connected, understands your ERP, and you trust it. Today that takes weeks of
          implementation calls. Here, your new hire onboards itself, asks you only what it can&apos;t work out, and gets to work while you watch.
        </p>

        {hired ? (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/desk" className="pressable inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-blue-800">
              <span className="grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: c!.bg }}>{initials(hired)}</span>
              Go to {hired}&apos;s desk <ArrowRight className="size-4" />
            </Link>
            <span className="text-xs text-muted">Want a fresh start? Use Reset demo at the top.</span>
          </div>
        ) : (
          <form action="/api/hire" method="post" className="mt-8 max-w-md">
            <label htmlFor="name" className="text-sm font-medium">What should we call your new AP employee?</label>
            <div className="mt-2 flex gap-2">
              <input
                id="name" name="name" required maxLength={24} autoComplete="off" placeholder="e.g. Asha"
                className="h-10 min-w-0 flex-1 rounded-md border border-line-2 bg-surface px-3 text-[15px] focus:border-accent focus:outline-none"
              />
              <button type="submit" className="pressable inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium whitespace-nowrap text-white hover:bg-blue-800">
                Hire · clock starts <ArrowRight className="size-4" />
              </button>
            </div>
            {error === "name" && <p className="mt-2 text-sm text-bad">Use 1–24 letters, numbers or spaces.</p>}
            <p className="mt-2 text-xs text-muted">No sign-up. Everything it touches is synthetic mock data.</p>
          </form>
        )}

        <div className="mt-10 border-t border-line pt-5 text-sm text-muted">
          <span className="font-medium text-ink-2">The one number this prototype is built around:</span> time from hire to the first bill your employee posts with your approval.
          Target <span className="font-semibold text-ink">under 60 minutes</span>.
        </div>
      </div>

      {/* The job description: what you're hiring, in plain terms. */}
      <aside className="h-fit rounded-xl border border-line bg-surface p-5">
        <div className="text-xs font-medium tracking-wide text-muted uppercase">Job description</div>
        <div className="mt-1 text-lg font-semibold">AP Specialist</div>
        <div className="text-sm text-muted">Accounts payable · reports to you · read-only NetSuite access</div>
        <div className="mt-4 text-xs font-medium text-ink-2">Will</div>
        <ul className="mt-1.5 space-y-1.5 text-sm">
          {WILL.map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{t}</li>)}
        </ul>
        <div className="mt-4 text-xs font-medium text-ink-2">Won&apos;t</div>
        <ul className="mt-1.5 space-y-1.5 text-sm">
          {WONT.map((t) => <li key={t} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-bad" />{t}</li>)}
        </ul>
        <p className="mt-4 rounded-md bg-gray-50 p-2.5 text-xs leading-relaxed text-muted">
          Supervised from day one. Autonomy is earned on your own invoices, not assumed.
        </p>
      </aside>
    </div>
  );
}
