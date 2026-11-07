# Zamp in an Hour

**A prototype that takes a finance team from zero to a working AP digital employee in under an hour, and measures it.**

> ⚠️ **All data is synthetic mock data.** The vendors, invoices, POs, receipts and the NetSuite sandbox are generated for this demo. There is no real ERP connection, no customer data and no Zamp data. This is an independent prototype by Ahad Nadeem, not a Zamp product.

**Live demo:** _<add Vercel URL>_ · **Decisions log:** [DECISIONS.md](DECISIONS.md)

---

## The problem

A digital employee is only valuable once it's **connected** to the ERP, its fields are **mapped**, and the finance team **trusts** it enough to let it act. Each of those steps tends to become a meeting, a spreadsheet and a week. Every week of setup is a week the customer pays without seeing value, and it caps how many customers an implementation team can bring live.

## The metric

**Time to first working digital employee.** Target: **< 60 minutes**, managed at p90.

Measured from **Start setup** to the **first vendor bill the AP employee posts after a passed 3-way match and a human approval**. The definition, edge cases and what it deliberately doesn't capture are in [DECISIONS.md §1](DECISIONS.md#1-the-metric).

## The flow (one hero path, done deeply)

| Step | What happens | The real logic underneath |
|---|---|---|
| 1. Connect NetSuite | Read-only token auth to a mock sandbox; discovers 5 vendors, 31 POs, 30 receipts, 12 historical bills | Faithful mock of NetSuite's record API (`/api/erp/{record}`) |
| 2. Map fields | 19 of 22 fields auto-map; 3 ambiguous custom fields come to you with evidence | Name + value-format + **referential** scoring; Gemini only for what rules can't verify; LLM never auto-approves |
| 3. Test sync | Streamed live log, **partial success** (76/78; 2 quarantined with reasons), **one-click undo** | Mapping applied and required fields validated per record |
| 4. AP employee | Reads 20 invoice PDFs (3 layouts), 3-way matches against synced POs and receipts | Gemini PDF extraction → deterministic match engine (28 unit tests) |
| 5. First bill | You approve; the bill posts to the mock ERP; the timer stops | Supervised mode: nothing is written without approval |

**Seeded exceptions**, each caught with a cited reason (document, field, value, rule):

| Invoice | Exception | What the employee says |
|---|---|---|
| `inv-06` | Price mismatch | Line 1 unit price ₹1,060 vs PO-2306 ₹1,000, +6.0% > 2% tolerance |
| `inv-11` | Missing receipt | No item receipt in NetSuite references PO-2311 |
| `inv-17` | Duplicate | `MDI42` normalises to the same number as paid bill `MDI-0042`, same total |
| `inv-19` | Quantity variance | Billed 120, received 100; 20 units unreceived |

Plus one +1.2% price variance that **passes with a warning**: within tolerance means no exception.

**Trust layer:** every action (agent or human) is in an append-only audit trail with evidence and before/after state. Posted bills, holds, rejections, mapping decisions and syncs can be **reversed** with a compensating entry.

**Measurement:** a live timer on every screen, plus a funnel (step conversion, median time per step, drop-off), p50/p90 time-to-first-employee and undo/reversal rates. Sessions come from real demo visitors, with rehearsals excluded.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js UI<br/>checklist rail + timer]
  end
  subgraph "Next.js route handlers (Vercel)"
    ERP["/api/erp/* <br/>mock NetSuite"]
    MAP["/api/mapping"]
    SYNC["/api/sync<br/>NDJSON stream + undo"]
    AGENT["/api/agent/process"]
    ACT["/api/invoices/*/decide<br/>/api/actions/*/reverse"]
    MET["/api/metrics"]
  end
  subgraph "Pure TS (unit-tested)"
    M[mapping.ts<br/>scorer]
    X[match.ts<br/>3-way match + duplicates]
  end
  G[(Gemini<br/>PDF extraction,<br/>mapping suggestions)]
  DB[(Postgres<br/>Neon · PGlite locally)]
  SEED[[seed.ts<br/>synthetic dataset + PDFs]]

  UI --> ERP & MAP & SYNC & AGENT & ACT & MET
  MAP --> M
  MAP -. low confidence only .-> G
  AGENT --> G
  AGENT --> X
  ERP --> SEED
  SYNC --> SEED
  MAP & SYNC & AGENT & ACT & MET --> DB
```

- **Every LLM result is labelled** *live*, *cached* or *precomputed fallback*, so the demo works without a key and never passes off a fallback as AI.
- **Workspaces:** each browser gets an isolated workspace via cookie (no auth, deliberately cut). "Reset demo" starts a new one.

## What I cut, and why

Multi-ERP, real ERP connection, auth/SSO/billing, email ingestion, outbound vendor emails, a tolerance-configuration UI, mobile, dark mode, multi-currency. None of them move the onboarding-time number for the first customer. Reasons for each are in [DECISIONS.md §18](DECISIONS.md#18-what-i-cut-and-why).

## Run it locally

Requires **Node 20.19+** (22 LTS recommended).

```bash
npm install
npm run dev          # http://localhost:3000. No database or API key needed.
```

- **No `DATABASE_URL`** → an in-process Postgres (PGlite) is created in `.data/`.
- **No `GEMINI_API_KEY`** → extraction and mapping suggestions use precomputed answers, labelled as such.
- **Real Gemini answers ship with the repo** (`src/data/gemini-cache.json`): every fresh database loads them as *cached*, so the demo shows genuine model reads even on Gemini's free tier (20 requests/day). See [DECISIONS.md §15](DECISIONS.md#15-llm-reliability-live-cached-or-fallback-always-labelled).

Optional `.env.local`:

```bash
GEMINI_API_KEY=...            # live extraction + mapping suggestions
GEMINI_MODEL=gemini-3.5-flash # override the model
DATABASE_URL=postgres://...   # Neon / any Postgres
```

Other scripts:

```bash
npm test        # unit tests: match engine + mapping scorer
npm run pdfs    # regenerate the 20 synthetic invoice PDFs from src/data/seed.ts
npm run cache:export  # snapshot live Gemini answers from the local DB (stop the dev server first)
```

Add `?internal=1` to any URL once to mark your browser as a rehearsal session (excluded from metrics).

## Repo map

```
src/data/seed.ts          synthetic vendors, POs, receipts, bills, invoices (deterministic)
scripts/generate-pdfs.ts  3 invoice layouts → public/mock-invoices/*.pdf
src/lib/mapping.ts        deterministic field-mapping scorer
src/lib/match.ts          3-way match, duplicate detection, citations
src/lib/llm.ts            Gemini calls with cache / rate limit / labelled fallback
src/lib/service.ts        sync, agent pipeline, decisions, reversal
src/lib/audit.ts          append-only action log + funnel events
src/app/                  screens and API routes
```
