# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# AresRPG RPC read-API + indexer error-log shipper — Bun runtime.
# The image installs the API's existing @sentry/node dependency once; Compose
# reuses it for the read server and the small indexer log-ship sidecar.
# Pinned by digest (tag: oven/bun:1-slim, resolved via `docker buildx imagetools
# inspect oven/bun:1-slim` on 2026-07-08 — re-resolve + bump when upgrading).
FROM oven/bun:1-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runtime
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

# Shared named volume target for the indexer JSONL + the shipper cursor. The
# sticky directory lets the two unprivileged image users share it safely.
RUN mkdir -p /var/log/aresrpg && chmod 1777 /var/log/aresrpg

# Run unprivileged (the `bun` user ships with the base image).
USER bun

# Config via env (see server.js): PORT, REDIS_URL, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC.
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["bun", "run", "server.js"]
