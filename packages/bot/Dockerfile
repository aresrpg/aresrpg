FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS build
WORKDIR /app
# The install layer stays cached until a manifest, the lockfile or a patch changes. The frozen
# lockfile spans the whole workspace, so every member's manifest must be present.
COPY package.json bun.lock ./
COPY patches ./patches
COPY packages/bot/package.json packages/bot/
COPY packages/discord/package.json packages/discord/
COPY packages/engine/package.json packages/engine/
COPY packages/fight/package.json packages/fight/
COPY packages/frontend/package.json packages/frontend/
COPY packages/immutable/package.json packages/immutable/
COPY packages/journal/package.json packages/journal/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun packages/bot/build.ts /app/dist
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
WORKDIR /app
COPY --from=build /app/dist/ /app/
USER bun
ENTRYPOINT ["bun", "/app/bot.js"]
