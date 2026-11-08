"use client";
// The document the employee is looking at, rendered with pdf.js so we can mark exactly the text it
// read. Highlights come from the extraction's own evidence quotes and the cited values of failed
// checks, so a highlight is never decoration: it is where the employee says it got the number.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cx } from "@/components/ui";

type Box = { x: number; y: number; w: number; h: number; text: string };

// pdf.js and one worker are started once (workerPort); each document is destroyed when you move on, which
// frees it without killing the shared worker. Starting a fresh worker per invoice was slower than the
// employee reads, so documents were torn down before they ever drew.
type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
export function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    if (!m.GlobalWorkerOptions.workerPort) m.GlobalWorkerOptions.workerPort = new Worker("/pdf.worker.min.mjs", { type: "module" });
    return m;
  });
  return pdfjsPromise;
}

const norm = (s: string) => s.replace(/Rs\.?|[₹,\s]/g, "").toLowerCase();

function matches(itemText: string, quote: string) {
  const a = norm(itemText), b = norm(quote);
  if (!a || !b) return false;
  return a.includes(b) || (b.includes(a) && a.length >= 4);
}

export function DocumentViewer({ file, title, highlights = [], failing = [], onClose }: {
  file: string; title: string; highlights?: string[]; failing?: string[]; onClose?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  // Track the panel width so the page always fits it.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render page 1 and collect the positions of its text.
  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let task: ReturnType<PdfJs["getDocument"]> | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        task = pdfjs.getDocument(file);
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width - 2) / base.width });
        const c = canvas.current;
        if (!c || cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.floor(viewport.width * dpr);
        c.height = Math.floor(viewport.height * dpr);
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        await page.render({ canvasContext: c.getContext("2d")!, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
        if (cancelled) return;
        setSize({ w: viewport.width, h: viewport.height });
        setDrawn(true);
        const content = await page.getTextContent();
        const out: Box[] = [];
        for (const it of content.items) {
          if (!("str" in it) || !it.str.trim()) continue;
          const t = pdfjs.Util.transform(viewport.transform, it.transform);
          const h = Math.hypot(t[2], t[3]);
          out.push({ x: t[4], y: t[5] - h, w: it.width * viewport.scale, h: h * 1.15, text: it.str });
        }
        if (!cancelled) setBoxes(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [file, width]);

  const marked = boxes?.filter((b) => highlights.some((q) => matches(b.text, q))) ?? [];
  const bad = new Set(boxes?.filter((b) => failing.some((q) => matches(b.text, q))) ?? []);

  return (
    <div className="animate-enter flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
        <span>{title}</span>
        <span className="flex items-center gap-3">
          {marked.length > 0 && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-amber-300" /> what I read</span>}
          Source document · mock
          {onClose && <button onClick={onClose} aria-label="Close document" className="hover:text-ink"><X className="size-3.5" /></button>}
        </span>
      </div>
      <div ref={wrap} className="min-h-0 flex-1 overflow-auto bg-gray-100">
        {failed ? (
          <iframe src={`${file}#toolbar=0&navpanes=0&view=FitH`} className="h-full w-full" title={title} />
        ) : (
          <div className="relative mx-auto bg-white shadow-sm" style={size ? { width: size.w, height: size.h } : undefined}>
            <canvas ref={canvas} className="block" />
            {marked.map((b, i) => (
              <span key={`${b.x}-${b.y}-${i}`} title={`Read: ${b.text}`}
                className={cx("animate-enter pointer-events-auto absolute rounded-[2px] mix-blend-multiply", bad.has(b) ? "bg-red-300/60 ring-1 ring-red-500" : "bg-amber-300/55")}
                style={{ left: b.x - 1, top: b.y - 1, width: b.w + 2, height: b.h + 2 }} />
            ))}
            {!drawn && <div className="absolute inset-0 grid min-h-60 place-items-center text-xs text-muted">Opening the document…</div>}
          </div>
        )}
      </div>
    </div>
  );
}
