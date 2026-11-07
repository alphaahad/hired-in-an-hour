"use client";
import Link from "next/link";
import { ArrowRight, Database, GitCompareArrows, ShieldCheck, Workflow } from "lucide-react";
import { Card } from "@/components/ui";
import { useChecklist } from "@/components/useChecklist";

const STEPS = [
  { icon: Database, title: "Connect NetSuite", body: "Read-only sandbox connection. We discover vendors, POs, goods receipts and past bills." },
  { icon: Workflow, title: "Map fields with confidence", body: "Standard fields map themselves. Ambiguous custom fields come to you with evidence." },
  { icon: GitCompareArrows, title: "Test sync, then undo if you like", body: "A live log, a partial-success summary, and a one-click undo. Nothing is written to the ERP." },
  { icon: ShieldCheck, title: "Supervise the AP employee", body: "It reads invoices, runs a 3-way match, cites every exception and waits for your approval." },
];

const PRIMARY_LINK = "pressable inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-blue-800";

export default function Start() {
  const { state } = useChecklist();
  const started = !!state?.workspace.setupStartedAt;
  const next = state?.steps.find((s) => !s.done)?.href ?? "/employee";

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <div className="max-w-2xl">
        <div className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Onboarding prototype · AP digital employee</div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">From a new finance team to a working AP employee in under an hour.</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          A digital employee is only valuable once it is connected, mapped and trusted. Today those three steps usually turn into weeks of
          implementation calls. This prototype compresses them into one guided flow and measures a single number:
        </p>
        <div className="mt-5 inline-flex items-baseline gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <span className="text-sm text-muted">Time to first working employee</span>
          <span className="text-lg font-semibold">target &lt; 60 min</span>
        </div>
        <p className="mt-2 text-xs text-muted">Measured from “Start setup” to the first vendor bill the employee posts and a human approves.</p>
        <div className="mt-7 flex items-center gap-3">
          {/* Real links, not JS buttons: they work even if clicked before the page finishes loading.
              The connect page starts the timer when it opens. */}
          <Link href={started ? next : "/setup/connect"} className={PRIMARY_LINK}>
            {started ? "Continue setup" : "Start setup · timer starts"} <ArrowRight className="size-4" />
          </Link>
          <span className="text-xs text-muted">No sign-up. Synthetic data only.</span>
        </div>
      </div>

      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <Card key={s.title} className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <s.icon className="size-4 text-accent" /> Step {i + 1}
            </div>
            <div className="mt-2 text-sm font-medium">{s.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{s.body}</p>
          </Card>
        ))}
      </div>

      <p className="mt-10 max-w-2xl text-xs leading-relaxed text-muted">
        All vendors, invoices, purchase orders, receipts and NetSuite records are synthetic <strong>mock data</strong> generated for this demo.
        The NetSuite connection is a faithful mock of its record API; no real ERP, customer or Zamp data is involved.
      </p>
    </div>
  );
}
