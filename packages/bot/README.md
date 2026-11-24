# Hosted bot

The hosted bot is the OAuth/MCP door for external AI clients and the fenced actor that plays a hosted wallet on
the game socket. How it works is the system law in [ARCHITECTURE.md](../../ARCHITECTURE.md#hosted-bot); this
file covers running and configuring it. Do not fund fixture identities: the tests use publicly known test keys.

## Roles and startup

Build the repository-root Docker context with `packages/bot/Dockerfile` (`build.ts` bundles the entry). One process
serves the HTTP door (`/connect/*`, `/authorize`, `/oauth/*`, `/.well-known/*`, `/mcp`, `/health`) and runs the actor.
A compromise of this process is full authority over its hosted wallets: Redis holds public descriptors and
AES-256-GCM encrypted Ed25519 seeds, never a plaintext key.

Several processes may run. A durable lease per wallet address keeps one owner process and fences the others;
observations and owner controls reach that owner through Redis pub/sub. A process needs an acknowledged subscription
before it claims a wallet, and losing it fails `/health` and stops its actors. Stop every old actor before starting
a new version.

The store needs Redis 7.2 or newer with durable, non-evicting persistence. Every key is
`<namespace>:<collection>[:<id>]`, built only by `keys` in `src/store.ts`: `bot:control` is the layout marker,
`bot:control:pending` the index of unfinished records and `bot:control:record:<kind>:<identity>` one aggregate.
Custody, grants, consent, authored trees and stop or lease decisions are durable. Commands, envelopes, receipts and
tree progress live only in the process that executes them; a restarted process starts each tree again from its root.

## Configuration

Required: `BOT_REDIS_URL`, `BOT_ISSUER` (HTTPS origin), `BOT_WEB_ORIGIN` (exact first-party HTTPS origin),
`BOT_SUI_RPC_URL` (HTTPS), `BOT_GAME_ENDPOINT` (WSS root), `BOT_AUTHORITY_GENERATION`, `BOT_SIGNING_KEYRING_FILE` and
`BOT_RECOVERY_MODE=true|false`. Provisioning and play stay off unless `BOT_PROVISION_ENABLED=true` and
`BOT_PLAY_ENABLED=true`. Rotating `BOT_AUTHORITY_GENERATION` invalidates every grant; owners consent again.

Optional: `BOT_SENTRY_DSN` with `BOT_DEPLOY_ENV` and `BOT_RELEASE` sends errors-only events that carry fixed codes and
bot source frames, never raw messages or wallet material. Without it the bot logs sanitized codes only.

Defaults, each overridable by a positive integer (`src/config.ts`): `BOT_PORT=3000`,
`BOT_OBSERVATION_FRESHNESS_MS=15000`, `BOT_REQUEST_TTL_MS=600000`, `BOT_CHALLENGE_TTL_MS=300000`,
`BOT_CODE_TTL_MS=60000`, `BOT_ACCESS_TTL_MS=900000`, `BOT_REFRESH_TTL_MS=7776000000`, `BOT_MAX_BODY_BYTES=65536`,
`BOT_MAX_REDIRECT_URIS=5`, `BOT_LEASE_MS=30000`, `BOT_HEARTBEAT_MS=10000` (shorter than the lease),
`BOT_TICK_MS=1000`, `BOT_REFUSAL_RETRY_MS=30000`, `BOT_SCAN_LIMIT=100` (pending keys per tick and concurrent work).
An invalid or empty override fails at startup.

The keyring file is `{ "active_key_id": "<version>", "keys": { "<version>": "<base64 of 32 random bytes>" } }`. It is
read at startup. Keep every key version that still seals a stored seed: deleting it loses that wallet. Wallet funding
is the only spending limit; there is no grant allowance.

## Checks

```bash
bun test               # the suites; Redis cases run when TEST_BOT_REDIS_URL names a loopback database 15
bun run typecheck
```
