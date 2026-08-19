# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# =============================================================================
# AresRPG server — the one realtime door.
# zkLogin-verified websocket serving the bound indexer set's graph and relaying
# player ephemera over the cluster mesh redis. Writes nothing.
#
# Build from the REPO ROOT (the workspace lockfile + sibling packages are the
# build context): docker build -f packages/server/Dockerfile .
#
# Env (see src/env.ts — every value has a working local default):
#   GRAPH_URL       redis://indexing:6379   the bound indexer set (graph + evt:*)
#   MESH_REDIS_URL  redis://mesh-redis:6379 the cluster mesh (player ephemera)
#   PORT, SUI_NETWORK, SUI_RPC_URL, ALLOWED_ORIGINS, MAX_PLAYERS
# =============================================================================

FROM oven/bun:1.3-slim AS runtime
WORKDIR /app

# The frozen lockfile spans the whole workspace, so every member's manifest must be
# present for the install to resolve; only the server's own dependency closure is
# copied as source below.
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY packages/fight/package.json packages/fight/
COPY packages/frontend/package.json packages/frontend/
COPY packages/immutable/package.json packages/immutable/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
# --ignore-scripts: the root "prepare" hook arms git hooks — meaningless in an image.
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY packages/server packages/server
COPY packages/protocol packages/protocol
COPY packages/fight packages/fight
COPY packages/immutable packages/immutable
# the zone-population twin: engine's pure recipe/biome sampling + the seed content it derives from
COPY packages/engine/src packages/engine/src
COPY seed/content seed/content
COPY seed/structures seed/structures

USER bun
EXPOSE 9800
CMD ["bun", "run", "packages/server/src/index.ts"]
