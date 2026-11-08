// Copies pdf.js's worker next to the app's static files, so the viewer loads the exact
// version that's installed. Runs on every `npm install` (postinstall), locally and on Vercel.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
console.log("Copied pdf.js worker to public/pdf.worker.min.mjs");
