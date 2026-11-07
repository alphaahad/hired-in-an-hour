"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Badge, Button, Card, ErrorNote, PageHeader, SourceBadge, api, cx, refreshState } from "@/components/ui";

type Source = { key: string; record: string; field: string; type: string; samples: string[] };
type Mapping = {
  source_key: string; target: string | null; confidence: number; method: "heuristic" | "llm" | "human"; reason: string;
  status: "auto" | "needs_review" | "approved" | "ignored"; llm_source: "live" | "cached" | "fallback" | null; source: Source;
};
type Target = { key: string; label: string; record: string; type: string; required: boolean; why: string };

const RECORD_LABEL: Record<string, string> = { vendor: "Vendor", purchaseOrder: "Purchase order", itemReceipt: "Item receipt", vendorBill: "Vendor bill" };

function Confidence({ v }: { v: number }) {
  const tone = v >= 0.8 ? "bg-ok" : v >= 0.6 ? "bg-warn" : "bg-bad";
  return (
    <span className="inline-flex items-center gap-1.5" title="Confidence">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-100"><span className={cx("block h-full", tone)} style={{ width: `${v * 100}%` }} /></span>
      <span className="text-xs text-ink-2">{Math.round(v * 100)}%</span>
    </span>
  );
}

export default function MappingPage() {
  const router = useRouter();
  const [data, setData] = useState<{ mappings: Mapping[]; targets: Target[]; ignore: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAuto, setShowAuto] = useState(false);

  const load = useCallback(() => api<NonNullable<typeof data>>("/api/mapping").then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const label = (t: string | null) => (!t ? "—" : t === data?.ignore ? "Not needed" : data?.targets.find((x) => x.key === t)?.label ?? t);
  const review = useMemo(() => data?.mappings.filter((m) => m.method === "llm" || m.method === "human" || m.status === "needs_review") ?? [], [data]);
  const auto = useMemo(() => data?.mappings.filter((m) => !review.includes(m)) ?? [], [data, review]);
  const pending = data?.mappings.filter((m) => m.status === "needs_review").length ?? 0;

  async function decide(m: Mapping, target: string) {
    setSaving(m.source_key);
    try {
      await api("/api/mapping", { json: { sourceKey: m.source_key, target } });
      await load();
      refreshState();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (err && !data) return <ErrorNote>{err} {err.includes("Connect") && <a className="underline" href="/setup/connect">Go to step 1</a>}</ErrorNote>;
  if (!data) {
    return (
      <div>
        <PageHeader eyebrow="Step 2 of 5" title="Review field mappings" />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Profiling 22 NetSuite fields: names, value formats and cross-record references. Asking Gemini only about the ones rules can&apos;t verify…
        </Card>
      </div>
    );
  }

  const options = (m: Mapping) => data.targets.filter((t) => t.record === m.source.record);

  return (
    <div>
      <PageHeader
        eyebrow="Step 2 of 5"
        title="Review field mappings"
        actions={<Button variant="primary" disabled={pending > 0} onClick={() => router.push("/setup/sync")}>Continue to test sync <ArrowRight className="size-4" /></Button>}
      >
        {auto.length} of {data.mappings.length} fields were mapped by deterministic rules with high confidence. {pending > 0 ? <><strong className="text-ink">{pending} need your decision</strong>: rules could not verify them, so the AI suggests and you decide.</> : "All decisions made."}
      </PageHeader>
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}

      <div className="space-y-3">
        {review.map((m) => {
          const decided = m.status !== "needs_review";
          return (
            <Card key={m.source_key} className={cx("p-4", !decided && "border-amber-300 ring-1 ring-amber-100")}>
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-[16rem_minmax(0,1fr)_17rem]">
                <div>
                  <div className="text-xs text-muted">{RECORD_LABEL[m.source.record]}</div>
                  <div className="font-mono text-sm font-medium">{m.source.field}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.source.samples.map((s) => <code key={s} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{s}</code>)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {decided ? <Badge tone="ok"><Check className="size-3" /> {m.status === "ignored" ? "Ignored" : "Approved"}</Badge> : <Badge tone="warn">Needs you</Badge>}
                    <span className="text-xs text-muted">{decided ? "Mapped to" : "Suggested"}</span>
                    <span className="text-sm font-medium">{label(m.target)}</span>
                    {!decided && <Confidence v={m.confidence} />}
                    {m.method === "llm" && <span className="inline-flex items-center gap-1 text-xs text-muted"><Sparkles className="size-3" /><SourceBadge source={m.llm_source} /></span>}
                    {m.method === "human" && <Badge>changed by you</Badge>}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{m.reason}</p>
                </div>
                <div className="flex items-start gap-2 md:justify-end">
                  {!decided && m.target && (
                    <Button size="sm" variant="primary" loading={saving === m.source_key} onClick={() => decide(m, m.target!)}>
                      {m.target === data.ignore ? "Agree: not needed" : "Accept suggestion"}
                    </Button>
                  )}
                  <select
                    value=""
                    disabled={saving === m.source_key}
                    onChange={(e) => e.target.value && decide(m, e.target.value)}
                    className="h-7 w-40 rounded-md border border-line-2 bg-surface px-1.5 text-xs text-ink-2"
                  >
                    <option value="">{decided ? "Change…" : "Map to something else…"}</option>
                    {options(m).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    <option value={data.ignore}>Not needed</option>
                  </select>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5">
        <button onClick={() => setShowAuto((s) => !s)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm">
          <ChevronDown className={cx("size-4 text-muted transition-transform", !showAuto && "-rotate-90")} />
          <span className="font-medium">{auto.length} fields auto-mapped</span>
          <span className="text-muted">name, value format and reference checks all agree (≥ 80%)</span>
        </button>
        {showAuto && (
          <table className="w-full border-t border-line text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">NetSuite field</th><th className="px-2 py-2 font-medium">Sample</th><th className="px-2 py-2 font-medium">Maps to</th>
                <th className="px-2 py-2 font-medium">Confidence</th><th className="px-2 py-2 font-medium">Why</th><th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {auto.map((m) => (
                <tr key={m.source_key} className="border-t border-line align-top">
                  <td className="px-4 py-2"><div className="text-[11px] text-muted">{RECORD_LABEL[m.source.record]}</div><div className="font-mono text-xs">{m.source.field}</div></td>
                  <td className="px-2 py-2 font-mono text-[11px] text-ink-2">{m.source.samples[0]}</td>
                  <td className="px-2 py-2">{label(m.target)}</td>
                  <td className="px-2 py-2"><Confidence v={m.confidence} /></td>
                  <td className="max-w-md px-2 py-2 text-xs text-muted">{m.reason}</td>
                  <td className="px-4 py-2 text-right">
                    <select value="" onChange={(e) => e.target.value && decide(m, e.target.value)} className="h-7 rounded-md border border-line px-1 text-xs text-muted">
                      <option value="">Change…</option>
                      {options(m).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      <option value={data.ignore}>Not needed</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
