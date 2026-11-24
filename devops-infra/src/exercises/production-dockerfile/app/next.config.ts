import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next build` writes a self-contained server to .next/standalone: server.js plus only the
  // node_modules files it needs. The runtime image copies that instead of the whole project.
  output: 'standalone',
  // The repository root has its own lockfile; this app is a project of its own. Next.js also uses
  // this folder as the file tracing root, so server.js lands at the top of .next/standalone.
  turbopack: { root: import.meta.dirname },
  // `next dev` would otherwise write an AGENTS.md for coding agents into the app folder.
  agentRules: false,
};

export default nextConfig;
