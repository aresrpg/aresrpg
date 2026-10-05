# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Build from the repository root. This image never starts the realtime server.

FROM oven/bun:1.3.5-slim@sha256:6111acec4c5a703f2069d6e681967c047920ff2883e7e5a5e64f4ac95ddeb27f AS runtime
WORKDIR /app

# The frozen lockfile spans the whole workspace, so every member's manifest must be
# present for the install to resolve; only the bot's dependency closure is
# copied as source below.
COPY package.json bun.lock ./
COPY packages/engine/package.json packages/engine/
COPY packages/fight/package.json packages/fight/
COPY packages/ui/package.json packages/ui/
COPY packages/frontend/package.json packages/frontend/
COPY packages/mobile/package.json packages/mobile/
COPY packages/journal/package.json packages/journal/
COPY packages/immutable/package.json packages/immutable/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/discord/package.json packages/discord/
# --ignore-scripts: the root "prepare" hook arms git hooks — meaningless in an image.
RUN bun install --filter @aresrpg/discord --frozen-lockfile --production --ignore-scripts

COPY packages/discord/src packages/discord/src
COPY packages/server/src/suins.ts packages/server/src/logger.ts packages/server/src/
COPY packages/immutable/src packages/immutable/src
COPY packages/ui/src packages/ui/src
COPY seed/content/items.json seed/content/mobs.json seed/content/
COPY seed/icons/items seed/icons/items
COPY seed/icons/mobs seed/icons/mobs
COPY packages/frontend/src/i18n/locales packages/frontend/src/i18n/locales

USER bun
EXPOSE 9801
CMD ["bun", "run", "packages/discord/src/index.ts"]
