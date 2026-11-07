// Snapshots the local Gemini cache (./.data/pglite) into src/data/gemini-cache.json.
// Why: the demo key is on Gemini's free API tier (20 requests/day per model). Committing the
// model's real answers lets every fresh database (including production) serve them as "cached"
// instead of spending quota or falling back. Only model outputs on synthetic data are written:
// no keys, no workspace data. Stop `npm run dev` first (PGlite allows one process).
import { PGlite } from "@electric-sql/pglite";
import { writeFileSync } from "node:fs";

const pg = new PGlite("./.data/pglite");
const { rows } = await pg.query<{ key: string; value: unknown; created_at: string }>(
  "select key, value, created_at from llm_cache order by created_at",
);
const out = rows.map((r) => ({ key: r.key, value: r.value, created_at: new Date(r.created_at).toISOString() }));
const text = JSON.stringify(out, null, 1) + "\n";
if (process.env.GEMINI_API_KEY && text.includes(process.env.GEMINI_API_KEY)) throw new Error("Refusing to write: snapshot contains the API key");
writeFileSync("src/data/gemini-cache.json", text);
console.log(`Wrote ${out.length} cached Gemini answers to src/data/gemini-cache.json`);
await pg.close();
