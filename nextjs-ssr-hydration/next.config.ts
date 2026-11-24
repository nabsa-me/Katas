import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Same TypeScript split as the other katas: tsconfig.json only references the real configs.
  typescript: { tsconfigPath: 'tsconfig.app.json' },
  // The repository root has its own lockfile (shared tooling); this kata is a project of its own.
  turbopack: { root: import.meta.dirname },
  // `next dev` would otherwise write an AGENTS.md for coding agents into the kata folder.
  agentRules: false,
};

export default nextConfig;
