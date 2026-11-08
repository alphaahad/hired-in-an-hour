# DECISIONS.md

Every product tradeoff in this build, in the order I made it. Each entry says what I chose, what I gave up, and why.
Items marked **GUESS** are assumptions about Zamp's product or customers that I couldn't verify from public material. Check these first.

---

## 1. The metric

**Decision:** Own one number: **time to first working digital employee**. The target is under 60 minutes.

**Definition (precise, because metrics drift):** wall-clock time from the moment a workspace **hires (names) its employee** to the moment the AP employee **posts its first vendor bill to the ERP after a passed 3-way match and a human approval**.
- It starts at hire, not at contract signature. In production I'd add a second clock, signature → first login, because that's where procurement and IT time hides.
- An *overridden* exception also stops the clock, since a human accepted the outcome. I record `decision` on the event so I can split the two later.
- If the bill is later reversed, the timestamp stands. Reversals are tracked separately as a trust signal (see 14).
- **I'd manage to p90, not median.** The median flatters you; the slow customers are the ones who churn before value.

**Why this number and not "accuracy" or "invoices processed":** a digital employee creates zero value until it's live, and every day of setup is a day the customer is paying without a return. Onboarding time is also the number that caps how fast Zamp can sell: implementation capacity is the bottleneck for an enterprise AI product. Accuracy matters, but only once you're live.

**GUESS:** that today's onboarding takes weeks and that ERP connection, mapping and trust are the long poles. It could just as well be security review, process discovery, or getting the customer's AP team in a room.

## 2. Go deep on one hero flow, not wide

**Decision:** one ERP, one process (AP invoice → 3-way match → post bill), done properly.
**Gave up:** multi-ERP, procurement, close, and expense flows.
**Why:** a shallow demo of five flows proves I can make screens. A deep version of one proves I understand where the work is: ambiguous custom fields, partial syncs, duplicates that are re-keyed, and the moment a controller decides whether to trust the machine.

## 3. NetSuite as the mock ERP

**Decision:** NetSuite, mocked faithfully (record names `vendor`, `purchaseOrder`, `itemReceipt`, `vendorBill`; `custbody_*` custom fields; `createdFrom` linking receipts to POs; a REST-style list envelope).
**Considered:** QuickBooks Online (it has a free sandbox, but no goods-receipt record, so a real 3-way match can't be modelled, and it signals SMB). Dynamics 365 Business Central (it has a free trial, I've shipped an integration for it before, and it has purchase receipts).
**Why NetSuite:** it's the standard ERP for the mid-market and enterprise finance teams Zamp sells to, and its record model makes 3-way match natural.
**Tradeoff:** NetSuite has no free sandbox, so a real connector needs a partner or customer account. Week-2 work either way.
**GUESS:** that NetSuite is among the most common ERPs in Zamp's book.

## 4. Mapping: rules first, LLM only where rules can't verify, human decides

**Decision:** a three-layer mapping pipeline.
1. **Deterministic scorer** (`src/lib/mapping.ts`). Name and synonym match (generic tokens like `date`/`code` count for less), value-format profiling (GSTIN regex, `PO-####`, ISO dates, numeric), and **referential checks**: do these values exist as keys in another record? Weighted 55% name / 35% values / 10% type.
2. **Gemini** is asked *only* about fields below 80% confidence, with the deterministic signals in the prompt.
3. **A human approves** anything the rules couldn't verify. **An LLM suggestion never auto-approves, whatever its confidence.**

**Result on the mock schema:** 19 of 22 fields auto-map. Exactly the three genuinely ambiguous custom fields come to a human (`custbody_ref1`, `custbody_svc_date`, `custbody_dept_code`). That's tested.

**Why not "LLM maps everything":** a wrong mapping fails silently and poisons every match downstream. Rules are explainable and free; the LLM earns its cost on the long tail. This mirrors what I shipped at TartanHQ (LLM mapping *suggestions*, not decisions).

**Why 80%:** it's tuned so standard fields clear it and custom fields don't. In production I'd set it from data: the threshold where human edits to auto-approved fields stay under ~1%.

**One target, one source:** if two fields both look like "invoice date", the stronger one wins and the other is flagged ("may not be needed"). That's how `custbody_svc_date` gets caught.

## 5. Test sync validates and quarantines; it doesn't drop silently

**Decision:** the sync applies the approved mapping, validates required canonical fields, and **quarantines** failing records with a reason. It reports *partial success* instead of all-or-nothing.
**Seeded on purpose:** two historical bills with a blank GL account. 76/78 sync, 2 are quarantined.
**Pass criterion:** every record type has data and fewer than 10% of records fail. Strict enough to catch a broken mapping (map `custbody_ref1` to "not needed" and every historical bill fails "Bill → PO link has no mapped source field"), and lenient enough not to block go-live on two bad historical rows.
**Why:** this is the partial-success flow I shipped at TartanHQ. All-or-nothing syncs make onboarding stall on one bad record.

## 6. Undo for the test sync

**Decision:** one click removes everything the run brought into the workspace. Because setup is read-only, undo is clean: NetSuite was never written to.
**Why:** people explore more when exploring is free. Undo also pauses the employee, since it only works on synced data.

## 7. The agent is real, the data is synthetic

**Decision:** the AP employee does real work. Gemini reads actual PDF bytes (three different layouts, so it's not one template). Then a deterministic engine does the 3-way match and duplicate detection. Synthetic data, real logic.
**Why split LLM and rules this way:** reading a document is a perception problem, so it goes to the model. Deciding whether to pay is a policy problem, so it goes to code you can test, replay and audit. The match engine has 28 unit tests.
**Defence in depth:** the matcher re-checks the extraction's own arithmetic (lines → subtotal → GST → total), so a misread number becomes an exception instead of a wrong payment.

## 8. Tolerances

**Decision:** unit price may exceed the PO by up to **2%** (passes with a warning); billed quantity may not exceed received quantity (0 tolerance); ₹1 rounding slack.
A seeded +1.2% invoice demonstrates the warning-but-pass path.
**GUESS:** real customers configure these per vendor or category. 2% is a common default, but I don't know Zamp's.

## 9. Duplicates: normalise, and check against paid bills

**Decision:** invoice numbers are normalised per segment (`MDI-0042`, `mdi 42` and `MDI42` all become `MDI42`). They're checked against bills already in the ERP **and** invoices earlier in the same batch, per vendor. A same-total match is cited as corroboration.
**Why:** the expensive duplicate is the one re-sent months later with a re-keyed number, after the original was paid. A naive exact-match check misses it.

## 10. Supervised mode first ("earned autonomy")

**Decision:** on day one the employee posts nothing without approval, even clean matches. "Approve all matched" exists so supervision isn't a chore.
**Next step (not built):** autonomy dials per vendor or amount, unlocked by track record (say 50 approvals with a 0% reversal rate).
**Why:** the fastest way to *first value* is not the fastest way to *full autonomy*. Trust is earned on the customer's own invoices, so the product should make that visible.

## 11. Exceptions come with citations

**Decision:** every exception names the document, field and value on both sides, plus the rule it broke. For example: "Invoice HSS-INV-3392, line 1 · unit price ₹1,060.00 vs NetSuite PO-2306, line 1 · rate ₹1,000.00, +6.0% exceeds the 2% tolerance (overbilled ₹3,000.00 across 50 units)".
**Why:** an AP clerk has to defend the decision to a vendor and an auditor. "The AI flagged it" isn't an answer.

## 12. Reversal is a compensating entry, never a delete

**Decision:** every state-changing action writes to an append-only `actions` log with evidence and before/after state. Reversing a posted bill **voids** it in the mock ERP and logs a new action; the original stays, struck through.
**Reversible:** mapping decisions, test syncs, posted bills, holds, rejections. **Not reversible (by design):** extraction and match. Those are observations, so you re-run them instead.
**Why:** finance systems don't delete history. This is the same model as the sync rollback and data restore I shipped.

## 13. Instrumentation: honest by construction

**Decision:**
- One session = one workspace. "Reset demo" starts a *new* workspace, so abandoned runs show up as drop-off instead of being overwritten.
- Funnel steps are recorded once per workspace; trust events (undo, reversal) every time.
- My own rehearsals are excluded (`?internal=1` marks a browser), with a toggle to include them.
- Visiting a setup page directly also starts the clock, so the metric can't be gamed by skipping the start page.
- The metrics page says plainly what it doesn't measure (credential procurement, IT approval, contract → first login).

## 14. Undo and reversal rates as a trust metric

**Decision:** track how often people undo syncs and reverse actions.
**Why:** a counter-metric for time-to-value. If onboarding gets faster but reversals climb, we're pushing people into trusting things they shouldn't.

## 15. LLM reliability: live, cached, or fallback, always labelled

**Decision:** every Gemini result is labelled **live**, **cached** (the identical input was answered before) or **precomputed fallback** (no key, rate limit, or model error).
**Why:** the demo must work flawlessly on a screen recording and when a reviewer opens it cold, but I won't pass off a precomputed answer as AI. Rate limits: 80 calls per workspace per hour, 3,000 per day globally.

**Free tier, on purpose.** The demo key is on Gemini's free API tier: **20 requests per day per model** plus a per-minute cap. Rather than pay for a demo, I:
- **Snapshot real answers.** `npm run cache:export` writes the model's actual outputs (synthetic invoices only, no keys) to `src/data/gemini-cache.json`, and every fresh database, including production, loads them as *cached*. Reviewers see genuine Gemini reads without spending quota. The snapshot now holds real Gemini reads of all 20 invoices and all 3 mapping suggestions (captured over two days of free-tier quota).
- **Retry once, then fall back honestly.** A per-minute 429 or a Google-side 503 waits briefly and retries once; a daily-quota 429 falls straight back, with the reason shown ("Gemini is rate-limiting this demo's key right now").
- **Pinned model** (`gemini-3.5-flash`, not `-latest`), so the cache keys and the behaviour don't shift under the recording.

**Live accuracy:** on the 17 PDFs compared field by field, every total, tax amount, line quantity, unit price, PO number and GSTIN was exact; the other 3 (read live a day later) produced the correct match outcome, including the re-keyed duplicate. The only differences were vendor-name formatting (all caps, or a city appended), which is why vendor identity is checked on GSTIN first.

**Production note:** with billing on, the snapshot becomes a warm cache rather than a workaround.

## 16. Throttled sync log

**Decision:** the mock sync sleeps 25 ms per record so the streamed log is readable. A real sync of 78 records would be I/O-bound and take similar time; I'm saying it here rather than hiding it.

## 17. Stack

| Choice | Why | Instead of |
|---|---|---|
| Next.js 16 + TypeScript + Tailwind | One deployable unit (UI and mock ERP API), Vercel-native | Separate API server |
| IBM Plex Sans (+ Plex Mono for field names, JSON and logs only) | Sturdy, renders well on Windows, reads as enterprise finance; amounts use tabular figures instead of monospace | Geist (thin on Windows), Inter |
| Postgres: Neon in prod, PGlite locally | SQLite doesn't persist on serverless; PGlite gives zero-setup `npm run dev` | SQLite / JSON files |
| Plain SQL, no ORM | ~10 tables; every query readable in review | Drizzle (planned, dropped as unnecessary) |
| Hand-rolled UI primitives | Five components; a quiet finance look doesn't need a library | shadcn/ui |
| Gemini 3.5 Flash (pinned, not `-latest`) | Native PDF input + JSON-schema output, low latency and cost | — |
| Vitest | The money logic (match, mapping) is unit-tested | — |

## 18. What I cut, and why

| Cut | Why it doesn't serve the metric (yet) |
|---|---|
| Multi-ERP | Depth beats breadth: the mapping engine is ERP-agnostic, connectors are not the hard part |
| Real ERP connection | No free NetSuite sandbox; the mock follows its record model |
| Auth, SSO, billing | Each visitor gets an isolated workspace via cookie |
| Email ingestion | Invoices arrive in an inbox folder; email parsing doesn't change the onboarding story |
| Vendor emails on hold | Drafted in the audit trail, never sent |
| Configurable tolerances UI | Defaults in code; per-vendor config is a week-2 item |
| Mobile, dark mode | AP review happens at a desk |
| Multi-currency | All INR; currency is mapped and would be checked |

## 19. GUESSES about Zamp (verify against zamp.ai)

1. Onboarding currently takes weeks, and connection, mapping and trust are the bottlenecks.
2. NetSuite is common among Zamp's customers.
3. Zamp maps customer ERPs to an internal canonical schema. Mine (`src/lib/mapping.ts → targets`) is invented.
4. Zamp presents digital employees as an inbox with human approvals (vs. chat or Slack-first).
5. Default tolerances: 2% price, 0 over-receipt.
6. There isn't already a self-serve setup flow. If there is, this becomes "here's how I'd measure and shorten it".
7. India GST invoices are relevant (I used Indian vendors; Zamp's customers are largely global).

## 20. The employee is the main character

**Problem (found by using it):** the first version worked but didn't land. The "employee" was a status column; its best work (reading a PDF, checking the PO and receipt, deciding to stop) happened in milliseconds off-screen; three of five steps were an admin wizard. It read as software, not a colleague.

**Decision:** the same engine, presented as a coworker you hire and supervise.
- **You hire it and name it.** The name is yours to choose (stored on the workspace; plain text, 1–24 characters). The clock starts at hire.
- **It onboards itself.** It asks for read-only access, maps 19 of 22 fields on its own, asks you only about the 3 it can't be sure of (in its own words, with its reasoning one click away), runs the test sync without being told, and explains what it set aside. Setup stops being a wizard and becomes three questions.
- **You watch it work.** One invoice at a time, it narrates each check and highlights on the actual PDF where it read each value (from the extraction's own evidence quotes and the cited values of failed checks).
- **It brings you decisions.** Matched bills arrive as one batch; each exception arrives as its own card with the citation, the rule, and a drafted vendor query. You can act while it keeps working. Pause and skip-ahead are always available.

**Honesty about pacing:** the narration paces the *display* of real results so a person can follow them (about 0.3s per check). It never fakes work: each invoice shows its real source (live, cached or fallback) and real read time, and a live Gemini read shows as "Reading…" for as long as it actually takes. Skip-ahead still does every check; it only stops narrating them.

**What stayed the same:** the match engine, mapping scorer, LLM layer, sync, reversal and metric are untouched. The old screens remain as records (Invoices, invoice detail, Audit trail, Metrics, and the setup pages behind "Review all" and "Log").

**Persona guardrails:** fictional and user-named; nothing is styled as Zamp's own product; the vendor query is drafted, never sent (email is out of scope), and says so.
