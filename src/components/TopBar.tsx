"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { MockBadge, cx, api } from "./ui";

const NAV = [
  { href: "/desk", match: "/desk", label: "Desk" },
  { href: "/employee", match: "/employee", label: "Invoices" },
  { href: "/audit", match: "/audit", label: "Audit trail" },
  { href: "/metrics", match: "/metrics", label: "Metrics" },
];

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Escape backs out of the confirm, wherever focus is.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function reset() {
    setBusy(true);
    await api("/api/reset", { json: {} });
    window.dispatchEvent(new Event("app:refresh"));
    router.push("/");
    router.refresh();
    setBusy(false);
    setConfirming(false);
  }
  return (
    <header className="material-bar sticky top-0 z-20 backdrop-blur-xl backdrop-saturate-[1.8] [@media(prefers-contrast:more)]:backdrop-blur-none [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded bg-ink text-[11px] font-bold text-white">1h</span>
          Hired in an Hour
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx("pressable rounded-md px-2.5 py-1.5 text-sm", path.startsWith(n.match) ? "bg-gray-100 font-medium text-ink" : "text-muted hover:text-ink")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <MockBadge />
          <span className={cx("hidden text-xs text-muted", !confirming && "xl:inline")}>A prototype by Ahad Nadeem</span>
          {/* Inline confirm instead of a browser dialog: the old run is kept (it stays in the metrics as its own session),
              so this is a mode switch, not a destructive action, and deserves a light touch. */}
          {confirming ? (
            <span className="animate-enter inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
              <span className="hidden text-muted sm:inline">New run? This one stays in the metrics.</span>
              <button autoFocus disabled={busy} onClick={reset} className="pressable rounded-md bg-ink px-2 py-1 font-medium text-white hover:bg-ink-2">
                {busy ? "Resetting…" : "Start fresh"}
              </button>
              <button disabled={busy} onClick={() => setConfirming(false)} className="pressable rounded-md px-2 py-1 text-muted hover:bg-gray-100 hover:text-ink">
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="pressable inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-gray-100 hover:text-ink"
            >
              <RotateCcw className="size-3" /> Reset demo
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
