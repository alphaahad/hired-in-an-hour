// One tiny query function over two drivers:
//  - Neon serverless Postgres when DATABASE_URL is set (production / Vercel)
//  - PGlite (Postgres compiled to WASM, in-process) otherwise, so `npm run dev` needs zero setup.
// Plain SQL instead of an ORM: ~10 tables, and every query stays readable in review.
import "server-only";

type Row = Record<string, unknown>;
type Driver = { query: (text: string, params?: unknown[]) => Promise<Row[]> };

const SCHEMA = `
create table if not exists workspaces (
  id text primary key,
  created_at timestamptz not null default now(),
  setup_started_at timestamptz,
  first_employee_at timestamptz,
  is_internal boolean not null default false,
  connection jsonb
);
create table if not exists mappings (
  workspace_id text not null,
  source_key text not null,
  target text,
  confidence real not null,
  method text not null,            -- heuristic | llm | human
  reason text not null,
  status text not null,            -- auto | needs_review | approved | ignored
  llm_source text,                 -- live | cached | fallback | null
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source_key)
);
create table if not exists sync_runs (
  id text primary key,
  workspace_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,            -- running | succeeded | partial | undone
  summary jsonb
);
create table if not exists synced_records (
  workspace_id text not null,
  run_id text not null,
  record_type text not null,
  record_id text not null,
  status text not null,            -- ok | failed
  error text,
  payload jsonb not null,
  primary key (workspace_id, record_type, record_id)
);
create table if not exists invoice_results (
  workspace_id text not null,
  invoice_id text not null,
  extraction jsonb,
  extraction_source text,          -- live | cached | fallback
  match jsonb,
  status text not null,            -- queued | processing | matched | exception | approved | rejected | on_hold | posted
  bill_id text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, invoice_id)
);
create table if not exists erp_writes (
  workspace_id text not null,
  id text not null,
  record_type text not null,
  data jsonb not null,
  status text not null,            -- open | voided
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create table if not exists actions (
  id text primary key,
  workspace_id text not null,
  ts timestamptz not null default now(),
  actor text not null,             -- agent | human | system
  type text not null,
  target text not null,
  summary text not null,
  evidence jsonb,
  before jsonb,
  after jsonb,
  reversible boolean not null default false,
  reversed_by text,
  reverses text
);
create index if not exists actions_ws on actions (workspace_id, ts desc);
create table if not exists events (
  id bigserial primary key,
  workspace_id text not null,
  ts timestamptz not null default now(),
  name text not null,
  props jsonb
);
create index if not exists events_ws on events (workspace_id, name);
create table if not exists llm_cache (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);
`;

const g = globalThis as unknown as { __db?: Promise<Driver> };

async function init(): Promise<Driver> {
  let driver: Driver;
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    driver = { query: async (text, params = []) => (await sql.query(text, params)) as Row[] };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = process.env.VERCEL ? "memory://" : "./.data/pglite";
    if (!process.env.VERCEL) (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    driver = { query: async (text, params = []) => (await pg.query<Row>(text, params)).rows };
  }
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await driver.query(stmt);
  await loadGeminiSnapshot(driver);
  return driver;
}

// Real Gemini answers captured earlier (scripts/export-llm-cache.mts), so a fresh database serves
// them as "cached" instead of spending free-tier quota. Never overwrites a newer live answer.
async function loadGeminiSnapshot(driver: Driver) {
  const { default: snapshot } = await import("@/data/gemini-cache.json");
  const entries = snapshot as { key: string; value: unknown; created_at: string }[];
  if (!entries.length) return;
  await driver.query(
    `insert into llm_cache (key, value, created_at)
     select e->>'key', e->'value', (e->>'created_at')::timestamptz from jsonb_array_elements($1::jsonb) e
     on conflict (key) do nothing`,
    [JSON.stringify(entries)],
  );
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  g.__db ??= init();
  const d = await g.__db;
  return (await d.query(text, params)) as T[];
}

export async function q1<T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export const json = (v: unknown) => JSON.stringify(v);
