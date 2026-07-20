# AresRPG gas-station image — the Bun Sui-sponsor service (api/sponsor.mjs, #51).
# Build context is THIS api/ dir — PRE-STEP: cp packages/sdk/src/deployment/release.json api/release.json
# (the allowlist bakes from it; stale bake = the 07-20 scope outage):
#   docker build -t <your-registry>/aresrpg/sponsor:<tag> api/ && docker push <your-registry>/aresrpg/sponsor:<tag>
# (multi-arch if the cluster needs it: docker buildx build --platform linux/amd64 ... --push)
# Runs as ONE long-lived pod so the in-memory anti-drain caps persist — see domains/aresrpg/charts/sponsor in the k8s repo.
FROM oven/bun:1-alpine

WORKDIR /app

# Deps first for layer caching — frozen lockfile, prod deps only (@mysten/sui).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY sponsor.mjs sponsor_state.mjs ./
COPY release.json /packages/sdk/src/deployment/release.json

# Non-root — the oven/bun image ships a 'bun' user at uid 1000 (matches the chart securityContext runAsUser: 1000).
USER bun

EXPOSE 9528
ENV SPONSOR_PORT=9528

# The Bun-standalone server at the bottom of sponsor.mjs (import.meta.main) → Bun.serve on the configured port (SPONSOR_PORT).
CMD ["bun", "sponsor.mjs"]
