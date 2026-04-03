import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default.
  // An empty turbopack config is enough — Turbopack handles Node.js module
  // stubs (fs, path, os, crypto) automatically for browser bundles.
  turbopack: {},
};

export default nextConfig;
