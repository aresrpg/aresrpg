# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Build from the repository root; Dockerfile.dockerignore beside this file is its whole context:
#   docker build -f packages/telegram/Dockerfile .
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
WORKDIR /app
COPY . .
# --ignore-scripts: the root "prepare" hook arms git hooks — meaningless in an image.
RUN bun install --filter @aresrpg/telegram --frozen-lockfile --production --ignore-scripts
USER bun
# Execute the installed runtime graph and read the locales once: an import or a document the context
# does not admit fails the build instead of the first update. Neither opens a socket.
RUN bun -e "await import('./packages/telegram/src/connected.ts'); await (await import('./packages/telegram/src/copy.ts')).load_copies()"
ENTRYPOINT ["bun", "/app/packages/telegram/src/index.ts"]
