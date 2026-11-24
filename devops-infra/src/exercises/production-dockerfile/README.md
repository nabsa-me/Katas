# Production Dockerfile

## Statement

A small Next.js app ([`app/`](./app/): one page and a `/api/health` Route Handler) ships with this Dockerfile:

```dockerfile
FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

It builds and serves the page, and there is no `.dockerignore`. Measured on this machine, the image takes 2.57 GB on disk (671 MB to push), runs as root, contains TypeScript and every other dev dependency, carries whatever was in the developer's folder (a local `.env` included), and was built on Node 26 the day `latest` pointed at Node 26. Rewrite it for production: multi-stage with Next.js `standalone` output, a non-root user, a pinned base image, a `HEALTHCHECK` and an ignore file, and explain the size difference.

## What gets assessed

- Multi-stage builds: what each stage is for and what reaches the final image.
- Next.js `output: 'standalone'`: what it produces and which folders you must copy next to it.
- Reproducibility and supply chain: tags versus digests, the lockfile and `npm ci`.
- Least privilege at runtime: non-root user, read-only code, Node as the main process.
- Measuring the result (`docker image ls`, `docker image inspect`) instead of guessing.

## How to approach it, step by step

1. Build the flawed image and measure it: `docker image ls`, `docker image inspect --format '{{.Config.User}}'`, and `docker run --rm --entrypoint ls <image> -a /app` to see what was copied.
2. Write the ignore file first: what must never reach the builder (`node_modules`, `.next`, `.env*`, `.git`).
3. Split the work: a `deps` stage with only `package.json` and the lockfile (`npm ci`), a `build` stage that runs `next build`, and a `runtime` stage that receives only build output.
4. Turn on `output: 'standalone'` in `next.config.ts` and copy `.next/standalone`, `.next/static` and `public` into the runtime stage.
5. Pin the base image by digest, add `USER`, `HEALTHCHECK`, `CMD ["node", "server.js"]`, and the `ENV` the server needs.
6. Rebuild, measure again, run it (`docker run -p 5811:3000`), and check the health status and `docker stop`.
7. Lint both files with hadolint (`npm run validate:dockerfile`).

## Solution explained

[`Dockerfile`](./Dockerfile) is the production version, [`Dockerfile.problem`](./Dockerfile.problem) the flawed one, and [`Dockerfile.dockerignore`](./Dockerfile.dockerignore) the ignore file. The app's [`next.config.ts`](./app/next.config.ts) enables the standalone output.

**Stages.** Four stages share one base:

```dockerfile
FROM node:22.23.5-bookworm-slim@sha256:66cb8ef7… AS base
FROM base AS deps      # package.json + package-lock.json → npm ci
FROM base AS build     # node_modules from deps + sources → next build
FROM base AS runtime   # only .next/standalone, .next/static and public
```

Only the last stage becomes the image; the others are build steps whose layers stay in the build cache. TypeScript, the type packages and the sources never reach the runtime image. Copying `package.json` and the lockfile before the sources means a code change reuses the cached `npm ci` layer; the cache mount (`RUN --mount=type=cache,target=/root/.npm`) keeps npm's download cache between builds without storing it in a layer.

**The standalone output.** With `output: 'standalone'`, `next build` traces which files the server really imports and writes `.next/standalone/`: a `server.js`, a `package.json` and a `node_modules` with only those files (48 MB here, against 370 MB for the full install in the flawed image). Two folders are not included on purpose, because a CDN usually serves them: `.next/static` (hashed JS and CSS) and `public`. The runtime stage copies them next to `server.js`; forgetting them gives a page without styles or scripts. The app sets `turbopack.root` to its own folder: this repository has lockfiles at several levels, and Next.js uses that root for file tracing, so `server.js` lands at the top of `.next/standalone` instead of under a nested path.

**Environment the server needs.** `server.js` reads `PORT` and `HOSTNAME` (`const hostname = process.env.HOSTNAME || '0.0.0.0'`). Docker sets `HOSTNAME` to the container's host name, so without `ENV HOSTNAME=0.0.0.0` the server listens only on the container's IP address: requests through the published port still work, but the health check on `127.0.0.1` gets `ECONNREFUSED` and the container turns unhealthy (reproduced with `docker run --hostname web-1 -e HOSTNAME=web-1`). `NODE_ENV=production` and `NEXT_TELEMETRY_DISABLED=1` complete it.

**Pinned base image.** `node:latest` is whatever the registry says today: the flawed image got Node 26.13.1 while the app declares `>=22.12` and was tested on 22. A tag such as `22.23.5-bookworm-slim` says the version, and the digest (`@sha256:…`) fixes the exact bytes, because a tag can be pushed again with a rebuilt image. Dependabot or Renovate can update the digest through a reviewed PR. `-slim` drops compilers and docs from the Debian base; nothing in a standalone server needs them.

**Non-root, read-only code.** The official image has a `node` user with uid 1000. The runtime stage uses `USER 1000:1000`, the number rather than the name: Kubernetes can only verify `runAsNonRoot` for a numeric user, and hadolint 2.15 reports a user name with DL3066. The copied files stay owned by root, so the process can run them but not modify them; the only writable folder is `.next/cache`. The image also runs with a read-only root filesystem: `docker run --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=1000,gid=1000 --cap-drop ALL --security-opt no-new-privileges -p 5811:3000 devops-infra-app:production` serves the page, which the [Kubernetes exercise](../kubernetes-deployment/README.md) relies on.

**`HEALTHCHECK`.** `HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health')…"]` uses Node's own `fetch`, so the image needs no `curl`. Docker runs it on a schedule and reports `healthy` or `unhealthy` (`docker inspect -f '{{.State.Health.Status}}'`); Compose and Swarm use it, but Kubernetes ignores it and uses its own probes. The endpoint checks nothing but the server itself, so a database outage never gets the container restarted.

**Node as the main process.** `CMD ["node", "server.js"]` (exec form) makes Node PID 1, and the Next.js server handles `SIGTERM`: `docker stop` finished in 0.85 s with exit code 143 (128 + SIGTERM). The flawed `npm start` runs three processes (`npm start` → `sh -c next start` → `next-server`), exits with code 1 on the same stop because npm reports the script as failed, and prints a warning: `"next start" does not work with "output: standalone" configuration`.

**The ignore file.** The build context is `app/`. BuildKit looks for an ignore file named after the Dockerfile next to it (`Dockerfile.dockerignore`) before the context's `.dockerignore`; that keeps the rules for the production Dockerfile only, and lets `Dockerfile.problem` show what happens without them. With it, a local `.env` stays out of every stage (checked with `docker build --target build`); without it, `COPY . .` put the `.env` into the flawed image, where anyone who can pull the image can read it. It also keeps a host `node_modules` (with Windows or macOS binaries) out of a Linux build.

**Measured sizes.** Built on this machine with Docker Engine 29 (containerd image store); `docker image ls` reports the disk usage (compressed content plus unpacked layers) and the content size (what a registry stores and a node pulls):

| Image                                             | Disk usage | Content size | User        | Node    |
| ------------------------------------------------- | ---------- | ------------ | ----------- | ------- |
| `devops-infra-app:problem` (`Dockerfile.problem`) | 2.57 GB    | 671 MB       | root (0)    | 26.13.1 |
| `devops-infra-app:production` (`Dockerfile`)      | 393 MB     | 95.6 MB      | node (1000) | 22.23.5 |
| Base `node:22.23.5-bookworm-slim` alone           | 329 MB     | 82.5 MB      | —           | 22.23.5 |

Most of the reduction comes from the base (`-slim` against the full Debian image with build tools) and from shipping the traced server instead of the full `node_modules`; the app adds about 13 MB of compressed content on top of the base.

**Next step: distroless.** `gcr.io/distroless/nodejs22-debian12:nonroot` has Node and nothing else: no shell, no package manager, uid 65532, entrypoint `/nodejs/bin/node`. It removes most of the base's attack surface, at a cost: no `RUN` in the runtime stage (create the cache folder in the build stage and `COPY --chown=65532:65532` it) and no shell for debugging (use `kubectl debug` with an ephemeral container).

**How it is proven.** `npm run validate:dockerfile` runs hadolint 2.15.1 in Docker: the Dockerfile has no findings, and `Dockerfile.problem` reports DL3007 (`latest`) and DL3059 (consecutive `RUN`). hadolint checks instructions and shell, not design, so [`dockerfile-policy.ts`](./dockerfile-policy.ts) checks the rest on the text (digest pin, more than one stage, non-root `USER`, `HEALTHCHECK`, no dev install or whole-context copy in the runtime stage, Node as `CMD`) and [`dockerfile-policy.test.ts`](./dockerfile-policy.test.ts) asserts that the problem breaks all of them, the solution none, and that the ignore file covers the essentials. The sizes, the user, the health status and the stop behaviour above were measured by building and running both images.

## Common mistakes

| Symptom                                                     | Cause                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The page loads without styles or client-side JavaScript     | `.next/static` (or `public`) not copied next to `server.js`; standalone does not include them.    |
| `Cannot find module '/app/server.js'`                       | `output: 'standalone'` missing, or the tracing root is a parent folder and `server.js` is nested. |
| Container `unhealthy` although the site answers             | `HOSTNAME` not set: the server listens on the container IP, not on `127.0.0.1`.                   |
| `npm ci` runs again after every code change                 | Sources copied before `npm ci`, so any change invalidates the dependency layer.                   |
| `container has runAsNonRoot and image has non-numeric user` | `USER node` instead of a numeric uid, with `runAsNonRoot` in Kubernetes.                          |
| `EACCES` writing under `/app` at runtime                    | Code owned by root on purpose; give the app a writable folder (`.next/cache`, `/tmp`) instead.    |
| A rebuild with no code change behaves differently           | A floating tag (`latest`, `22`) resolved to a newer image; pin the digest.                        |

## Practice

Switch the runtime stage to `gcr.io/distroless/nodejs22-debian12:nonroot`, keep the health check working without a shell, and measure the new size against the table above.
