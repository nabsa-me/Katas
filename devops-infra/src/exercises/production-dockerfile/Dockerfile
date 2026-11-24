# Production image for the sample Next.js app. Build from the kata folder:
#   docker build -f src/exercises/production-dockerfile/Dockerfile -t devops-infra-app:production src/exercises/production-dockerfile/app
# The build context is app/; Dockerfile.dockerignore (next to this file) keeps it small.

# One base for every stage, pinned by digest: the tag says which version it is, the digest
# guarantees the exact bytes (a tag can be moved to a rebuilt image).
FROM node:22.23.5-bookworm-slim@sha256:66cb8ef75184df13dc0dcf866330488996b485d404db60555756865300ced4a5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies from the lockfile only: this layer is rebuilt only when package*.json change.
# The cache mount keeps npm's download cache between builds without adding it to the layer.
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Build with the dev dependencies (TypeScript, type packages). None of them reaches the runtime.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runtime: the standalone server with its traced node_modules, the static assets and public/.
# The files stay owned by root, so the app user can run the code but not change it; only the
# Next.js cache folder is writable.
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
RUN mkdir .next/cache && chown 1000:1000 .next/cache
# The `node` user of the official image, by number: Kubernetes can only verify runAsNonRoot for a
# numeric user, and hadolint (DL3066) asks for one too.
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node itself is the main process, so it receives SIGTERM from `docker stop` or Kubernetes.
CMD ["node", "server.js"]
