# AresRPG gas-station image — the Bun Sui-sponsor service (api/sponsor.mjs, #51).
# Build context is the REPO ROOT, so the allowlist bakes from the canonical release.json in place —
# there is no copied `api/release.json` to go stale (that copy, and the human `cp` pre-step guarding
# it, were the 07-20 scope outage's mechanism; #2026 removed both):
#   docker build -f api/Dockerfile -t <your-registry>/aresrpg/sponsor:<tag> .
# (multi-arch if the cluster needs it: docker buildx build --platform linux/amd64 ... --push)
# The root `.dockerignore` keeps that context at ~0.5 MB — it exists for this build alone.
# Runs as ONE long-lived pod so the in-memory anti-drain caps persist — see domains/aresrpg/charts/sponsor in the k8s repo.
FROM oven/bun:1-alpine

WORKDIR /app

# Deps first for layer caching — frozen lockfile, prod deps only (@mysten/sui).
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY api/sponsor.mjs api/sponsor_state.mjs api/zklogin_auth.mjs api/turn_credentials.mjs api/server.mjs api/report.js ./
# sponsor.mjs imports '../packages/sdk/src/deployment/release.json' — from /app that resolves here.
COPY packages/sdk/src/deployment/release.json /packages/sdk/src/deployment/release.json

# Non-root — the oven/bun image ships a 'bun' user at uid 1000 (matches the chart securityContext runAsUser: 1000).
USER bun

EXPOSE 9528
ENV SPONSOR_PORT=9528

# Sponsor router on SPONSOR_PORT.
CMD ["bun", "server.mjs"]
