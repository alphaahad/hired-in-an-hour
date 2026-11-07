"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Lock, PlugZap } from "lucide-react";
import { Badge, Button, Card, ErrorNote, PageHeader, api, refreshState } from "@/components/ui";
import { useChecklist } from "@/components/useChecklist";

type Conn = { accountId: string; connectedAt: string; counts: Record<string, number> };
const LABELS: Record<string, string> = { vendor: "Vendors", purchaseOrder: "Purchase orders", itemReceipt: "Item receipts", vendorBill: "Vendor bills (history)" };

export default function Connect() {
  const router = useRouter();
  const { state } = useChecklist();
  const [accountId, setAccountId] = useState("TSTDRV2026417");
  const [token, setToken] = useState("nsk_sandbox_7f3a9c2e41b8");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [sample, setSample] = useState<string | null>(null);

  // Visiting setup directly still starts the clock: the metric must not be gameable by skipping the start page.
  useEffect(() => {
    if (state && !state.workspace.setupStartedAt) api("/api/setup/start", { json: {} }).then(refreshState);
  }, [state]);
  const alreadyConnected = state?.steps.find((s) => s.key === "connect")?.done;

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ connection: Conn }>("/api/erp/connect", { json: { accountId, token } });
      setConn(r.connection);
      const s = await api<{ items: unknown[] }>("/api/erp/purchaseOrder?limit=1");
      setSample(JSON.stringify(s, null, 2));
      refreshState();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Step 1 of 5" title="Connect NetSuite">
        The AP employee needs read access to four record types. It never writes to your ERP during setup.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md bg-gray-100 text-xs font-bold text-ink-2">NS</div>
            <div>
              <div className="text-sm font-medium">NetSuite · token-based authentication</div>
              <div className="text-xs text-muted">Mock sandbox. Credentials are pre-filled for the demo.</div>
            </div>
            <Badge tone="warn" className="ml-auto">Mock connector</Badge>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-ink-2">Account ID</span>
              <input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line-2 px-2.5 font-mono text-sm focus:border-accent focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-2">Sandbox token</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" className="mt-1 h-9 w-full rounded-md border border-line-2 px-2.5 font-mono text-sm focus:border-accent focus:outline-none" />
            </label>
          </div>

          <div className="mt-5 flex items-center gap-3">
            {conn || alreadyConnected ? (
              <Button variant="primary" onClick={() => router.push("/setup/mapping")}>Continue to field mapping <ArrowRight className="size-4" /></Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={connect}><PlugZap className="size-4" /> Test connection</Button>
            )}
            {(conn || alreadyConnected) && <span className="flex items-center gap-1 text-sm text-ok"><CheckCircle2 className="size-4" /> Connected</span>}
          </div>
          {err && <div className="mt-4"><ErrorNote>{err}</ErrorNote></div>}

          {conn && (
            <div className="mt-6">
              <div className="text-xs font-medium text-muted">Discovered in sandbox {conn.accountId}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(conn.counts).map(([k, n]) => (
                  <div key={k} className="rounded-md border border-line px-3 py-2">
                    <div className="font-mono text-lg font-semibold">{n}</div>
                    <div className="text-xs text-muted">{LABELS[k] ?? k}</div>
                  </div>
                ))}
              </div>
              {sample && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-muted hover:text-ink">Raw response · GET /record/v1/purchaseOrder?limit=1</summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-ink-2">{sample}</pre>
                </details>
              )}
            </div>
          )}
        </Card>

        <Card className="h-fit p-5">
          <div className="flex items-center gap-1.5 text-sm font-medium"><Lock className="size-4 text-muted" /> What the employee can see</div>
          <ul className="mt-3 space-y-2 text-sm">
            {["Vendors", "Purchase orders", "Item receipts", "Vendor bills"].map((r) => (
              <li key={r} className="flex justify-between"><span className="text-ink-2">{r}</span><Badge>read</Badge></li>
            ))}
            <li className="flex justify-between border-t border-line pt-2"><span className="text-ink-2">Create vendor bill</span><Badge tone="accent">after your approval</Badge></li>
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">Least privilege by default. The employee asks before every write until you raise its autonomy.</p>
        </Card>
      </div>
    </div>
  );
}
