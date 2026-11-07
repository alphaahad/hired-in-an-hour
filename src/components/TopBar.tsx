"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { MockBadge, cx, api } from "./ui";

const NAV = [
  { href: "/setup/connect", match: "/setup", label: "Setup" },
  { href: "/employee", match: "/employee", label: "AP employee" },
  { href: "/audit", match: "/audit", label: "Audit trail" },
  { href: "/metrics", match: "/metrics", label: "Metrics" },
];

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded bg-ink text-[11px] font-bold text-white">1h</span>
          Zamp in an Hour
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx("rounded-md px-2.5 py-1.5 text-sm", path.startsWith(n.match) ? "bg-gray-100 font-medium text-ink" : "text-muted hover:text-ink")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <MockBadge />
          <span className="hidden text-xs text-muted lg:inline">Prototype by Ahad Nadeem · not a Zamp product</span>
          <button
            disabled={busy}
            onClick={async () => {
              if (!confirm("Start a fresh demo workspace? Your current run stays in the metrics as its own session.")) return;
              setBusy(true);
              await api("/api/reset", { json: {} });
              window.dispatchEvent(new Event("zamp:refresh"));
              router.push("/");
              router.refresh();
              setBusy(false);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-gray-100 hover:text-ink"
          >
            <RotateCcw className="size-3" /> Reset demo
          </button>
        </div>
      </div>
    </header>
  );
}
