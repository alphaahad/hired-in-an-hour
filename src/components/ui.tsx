"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-blue-800",
        variant === "secondary" && "bg-surface text-ink border border-line-2 hover:bg-gray-50",
        variant === "ghost" && "text-ink-2 hover:bg-gray-100",
        variant === "danger" && "bg-surface text-bad border border-red-200 hover:bg-bad-soft",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

const TONES = {
  neutral: "bg-gray-100 text-ink-2",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function MockBadge() {
  return (
    <span title="Every vendor, invoice, PO and NetSuite record in this app is synthetic." className="rounded border border-red-200 bg-bad-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-bad uppercase">
      Mock data
    </span>
  );
}

export function SourceBadge({ source, note }: { source: "live" | "cached" | "fallback" | null | undefined; note?: string | null }) {
  if (!source) return null;
  const map = { live: ["ok", "Gemini · live"], cached: ["accent", "Gemini · cached"], fallback: ["warn", "Precomputed fallback"] } as const;
  const [tone, label] = map[source];
  const title = source === "cached" ? "The same input was sent to Gemini earlier; reusing that answer." : source === "fallback" ? note || "Model unavailable; using a precomputed answer." : "Called Gemini just now.";
  return <span title={title}><Badge tone={tone}>{label}</Badge></span>;
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-6">
      <div>
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children && <div className="mt-1.5 max-w-2xl text-sm text-muted">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{children}</div>;
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Tell the checklist rail (and anything else listening) that state changed. */
export const refreshState = () => window.dispatchEvent(new Event("zamp:refresh"));
