import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // tsconfig.json only holds the project references; the app's settings live in tsconfig.app.json.
  typescript: { tsconfigPath: 'tsconfig.app.json' },
  // The kata has its own lockfile inside the repository's: without this, Turbopack picks the outer folder.
  turbopack: { root: import.meta.dirname },
  // Otherwise `next dev` writes an AGENTS.md into the folder when it detects a coding agent.
  agentRules: false,
};

export default nextConfig;
