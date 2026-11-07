import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen is per-workspace and dynamic; the static-shell model buys nothing here.
  cacheComponents: false,
  // PGlite ships WASM + data files that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The agent reads the mock invoice PDFs from disk inside the serverless function.
  outputFileTracingIncludes: {
    "/api/agent/**": ["./public/mock-invoices/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
