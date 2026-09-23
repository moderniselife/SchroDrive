import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    // ContentManager (the parent directory) has its own package.json + bun.lock
    // declaring a separate Bun workspace (backend/frontend) that `landing` isn't
    // part of. Turbopack's root auto-detection walks up looking for a lockfile
    // and finds that one first, misinferring it as the project root — since
    // `next` only lives in landing/node_modules, that breaks module resolution
    // ("Next.js package not found"). Pin the root to this directory instead.
    root: __dirname,
  },
};

export default nextConfig;
