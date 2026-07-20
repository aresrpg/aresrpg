# AresRPG RPC read-API — Bun HTTP JSON server.
# Tiny image: the official Bun runtime + the source. No build step, no deps
# (Redis client + HTTP server are Bun built-ins).
# Pinned by digest (tag: oven/bun:1-slim, resolved via `docker buildx imagetools
# inspect oven/bun:1-slim` on 2026-07-08 — re-resolve + bump when upgrading).
FROM oven/bun:1-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runtime
WORKDIR /app

# Source only (there is no node_modules — nothing to install).
COPY . .

# Run unprivileged (the `bun` user ships with the base image).
USER bun

# Config via env (see server.js): PORT, REDIS_URL, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC.
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["bun", "run", "server.js"]
