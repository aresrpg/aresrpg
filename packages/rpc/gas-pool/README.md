# Self-hosted Mysten gas pool (`sui-gas-pool`)

The official Mysten gas pool sponsors player transactions at scale — it owns and
auto-manages a sponsor address' gas coins (split / reserve / release) so
concurrent transactions never starve on a single coin. It signs only the
**sponsor** half of a transaction; the client still builds the whole PTB and the
app re-verifies the sender signature before execution. The pool controls gas,
never sender or commands.

It is **opt-in** and lives outside the read-only RPC (redis + indexer + api).
Enable it with the `gas` compose profile.

## The key: fresh + dedicated, never a production key

The pool's key is a live signer. It **must** be its own fresh, funded testnet key
— **never `SUI_MASTER_KEY`** or any named production wallet (prod-key fence law).
Unlike the predecessor script, nothing here reads `SUI_MASTER_KEY`.

```bash
bun generate-keypair.mjs        # prints a NEW address + GAS_POOL_KEYPAIR
sui client faucet --address 0x… # fund the printed address on testnet
```

Put the printed `GAS_POOL_KEYPAIR=…` line in the project `.env` (gitignored).

## Run with Docker (opt-in profile)

```bash
# From packages/rpc, with GAS_POOL_KEYPAIR + GAS_STATION_AUTH + SUI_FULLNODE_URL set in .env:
docker compose --profile gas up gas-pool
curl -s localhost:9527/    # -> ok
```

No public image exists, so the first build compiles `sui-gas-station` from source
(the full Sui cargo compile — slow and memory-hungry, like the indexer). That is
why it is gated behind `--profile gas`: the default `docker compose up` stays
lean. `entrypoint.sh` renders `config.local.yaml` from env at start, so the
sponsor secret is never baked into the image.

## Run natively (lighter for local dev)

The heavy Docker build can wedge Docker Desktop; running the binary natively
avoids it:

```bash
# 1. Build the station once (~a few minutes):
git clone --depth 1 https://github.com/MystenLabs/sui-gas-pool.git
cd sui-gas-pool && cargo build --release --bin sui-gas-station && cd -

# 2. Render the config from env (writes gitignored config.local.yaml):
GAS_POOL_KEYPAIR=… GAS_POOL_REDIS_URL=redis://127.0.0.1:6379 \
  SUI_FULLNODE_URL=<the JSON-RPC endpoint this deploy uses> bun generate-config.mjs

# 3. Start it (auto-splits the sponsor's coins to target-init-balance):
GAS_STATION_AUTH=<bearer-token> \
  ../sui-gas-pool/target/release/sui-gas-station --config-path ./config.local.yaml

# 4. Health check
curl -s localhost:9527/    # -> ok
```

## Config knobs (env)

| Var                            | Default                  | Meaning                                                                                                                            |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GAS_POOL_KEYPAIR`             | — (required)             | `suiprivkey1…` bech32 wallet export (preferred — what a prod wallet gives you) or legacy base64 `flag\|\|secret` (fresh + funded)  |
| `GAS_STATION_AUTH`             | — (required)             | bearer token (server-side callers ONLY — never a browser)                                                                          |
| `GAS_POOL_REDIS_URL`           | `redis://127.0.0.1:6379` | coin-state store                                                                                                                   |
| `SUI_FULLNODE_URL`             | — (required)             | JSON-RPC endpoint the pool talks to — deploy-time input, never defaulted ([#1421](https://github.com/aresrpg/aresrpg/issues/1421)) |
| `GAS_POOL_PORT`                | `9527`                   | station RPC port                                                                                                                   |
| `GAS_POOL_DAILY_CAP`           | `200000000`              | global daily spend cap (MIST) — 0.2 SUI/day, owner anti-drain constitution                                                         |
| `GAS_POOL_MAX_PER_REQUEST`     | `100000000`              | per-`reserve_gas` budget ceiling (MIST) — 0.1 SUI = the app's `GAS_CEILING_SUI`                                                    |
| `GAS_POOL_TARGET_INIT_BALANCE` | `100000000`              | per-coin target balance (MIST)                                                                                                     |

## Access model (ruling 2026-07-10) — internal primitive, ONE public door

The station is **identity-blind by design**: `reserve_gas` carries no sender, no zkLogin proof, no balance
context — it cannot enforce per-player policy and never will. By design, it is an **internal
primitive**, reachable ONLY by our fronting sponsor service (`api/sponsor.mjs`), which owns ALL identity
policy (zkLogin-only, >0.2 SUI ⇒ self-pay, per-address rate, global daily cap, stats). The S-64
client-direct path (`VITE_GAS_STATION_URL`/`VITE_GAS_STATION_AUTH` + `frontend/src/tx/gas_station.ts`) was
**deleted** — a browser-held bearer on an identity-blind sponsor is a drain defect regardless of caps.
`GAS_STATION_AUTH` must never reach a browser bundle.

The native caps above (0.2 SUI/day, 0.1 SUI/request) are defense-in-depth BEHIND that service — they bound
the blast radius even if the bearer leaks, they do not replace identity policy.

**Planned (ticketed, not built): sponsor.mjs → station delegation.** sponsor.mjs keeps its public API and
gates, but internally swaps its own coin-picking (`listCoins` + random choice — equivocation-prone at scale)
for the station's `reserve_gas`/`execute_tx` with the server-side bearer. Backend-only change at the existing
door; the client never learns.

### Station wire protocol (proven live in QA, 2026-07-09 — retained for the delegation ticket)

Bearer `Authorization` on both endpoints:

- `POST /v1/reserve_gas` `{ gas_budget, reserve_duration_secs }` →
  `{ result: { sponsor_address, reservation_id, gas_coins: [{objectId, version, digest}] }, error }`
- `POST /v1/execute_tx` `{ reservation_id, tx_bytes, user_sig }` → `{ effects, error }` — effects PRESENT ⇒
  EXECUTED (never retry); effects null + error ⇒ pre-execution rejection (no gas burned).

A real sponsored `zones::join_world` rode reserve → sender-sign → station sponsor-sign → execute to digest
`2coyX6ihxaDEw2KFgLmV8SHMJDpP8cyrmWNEjcmMYYFE` (Success); `balance_changes` showed **only the sponsor** paid
gas (−1,615,144 MIST). Money laws held: budget derived (sim gross ×1.5), would-fail tx refused BEFORE
`reserve_gas`, exactly one `execute_tx`, reserved coin released after use.

**`set_sponsor` ceremony (needed WHEN the delegation lands):** `create_character_free` gates on
`ctx.sponsor() == gate.sponsor` (`creation.move:137`), so if station coins start paying for free mints, the
on-chain gate must point at the address `GAS_POOL_KEYPAIR` derives to (read it from a live `reserve_gas`
`result.sponsor_address`), funded first, owner/lead-signed with the `AdminCap` — never autonomous.

**Note — dedicated key (S-64 finding).** On testnet the pool ran with `GAS_POOL_KEYPAIR == SPONSOR_DEV_KEY`
(both derive to `0x287b…d547`), so while `sponsor.mjs` and the station both run they can pick/reserve the
**same** coin (equivocation risk — exactly what the delegation ticket removes). For mainnet, mint a fresh
dedicated key (`bun generate-keypair.mjs`), fund it, and point the station at it.

## Files

- `generate-keypair.mjs` — mint a fresh dedicated sponsor key (via `sui keytool`).
- `generate-config.mjs` — render `config.local.yaml` from env (secret stays out of git).
- `entrypoint.sh` — container start: render config, then run the station.
- `Dockerfile` — build-from-source station image (used by `--profile gas`).
- `config.local.yaml` — generated, **gitignored** (holds the sponsor secret).
