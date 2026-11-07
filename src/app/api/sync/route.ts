import { runSync, latestSync } from "@/lib/service";
import { getWorkspace } from "@/lib/workspace";

export const maxDuration = 60;

export async function GET() {
  const w = await getWorkspace();
  return Response.json({ run: (await latestSync(w.id)) ?? null });
}

// Streams the sync log as NDJSON so the UI can render it line by line.
export async function POST() {
  const w = await getWorkspace();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const line of runSync(w.id)) controller.enqueue(enc.encode(JSON.stringify(line) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ t: 0, level: "error", msg: `Sync crashed: ${(e as Error).message}` }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
