// D105 CLASS-KILLER — network-hitting regression test (live Sui testnet) for the gRPC `{ object }` /
// `{ objects }` / `{ dynamicFields }` / `{ dynamicField }` / `{ balance }` wrapper class.
//
// WHY THIS EXISTS: the P1-α jsonRpc→gRPC migration (#23) rewrote every chain read onto `grpc_client.core.*`.
// Those Core methods return their payload WRAPPED: `getObject` → `{ object:{ objectId, version, type, json } }`,
// `getObjects` → `{ objects }`, `listOwnedObjects` → `{ objects, cursor, hasNextPage }`, `listDynamicFields`
// → `{ dynamicFields, ... }`, `getDynamicField` → `{ dynamicField }`, `getBalance` → `{ balance:{ balance } }`.
// α destructured MOST consumers correctly but MISSED the wrapper in the (since-retired) read_dungeon.js
// (`get_dungeon` read `result.json`/`result.version` DIRECTLY → undefined → 'no readable content' threw + the
// fight-engine W1 monotonic guard's clock silently read 0) and in `read_party.js`. That killed the
// DUNGEON-ENTRY LOOP (P0, caught by qa's adversarial matrix) — the door was dead. D105 was the full sweep +
// these asserts. (The chain-io split deleted read_dungeon.js — zero runtime importers, the dungeon flow reads
// /v1 + the run store now — so the getObject-wrapper assert below probes the shared-registry fixture DIRECTLY.)
//
// This test drives REAL SHIPPED READ SEAMS (not a re-probe): the app's own get_sdk() (the ONE chain effect
// edge every consumer shares) for a raw `{ object }` getObject decode, and `get_owned_items` from
// read_staking.js (the kiosk-union walk — getOwnedKiosks / getKiosk / `{ object }` getObject wrappers) — and
// asserts the DECODED shape, which is only possible if each seam unwrapped its Core wrapper. A future
// re-migration that drops a `{ object }` destructure makes the matching assert throw/return-empty and turns
// this test RED. **It would have caught D105 the second α merged.** (The old get_stakes/read_rest_until smokes
// were dropped when the read-surface audit deleted the retired staking readers.)
//
// NETWORK: hits https://fullnode.testnet.sui.io:443 via the app's own get_sdk() (SuiGrpcClient). ON by default;
// set ARES_SKIP_LIVE=1 to skip in an offline CI lane. Generous timeouts — testnet gRPC can be slow.

import { beforeAll, describe, expect, it } from 'bun:test'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { get_owned_items } from './read_staking.js'
import { get_sdk } from './sdk'
import { DEMO_NETWORK } from './deployment'

// The merged package's type-origin id (SDK deployment home) — a stable owned-objects dummy owner + type source.
const PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

// LIVE-NETWORK FIXTURE: the OLD-lineage shared DungeonRegistry (type-origin 0x29f6b3be…, orphaned by the S-46
// split — phase B retired its world-shell browse consumers). It still EXISTS on-chain, which is all these
// wrapper-regression tests need: a real shared object whose getObject decode proves the gRPC wrapper
// unwrapping. Deliberately NOT in the SDK deployment home (live ids only) — a test fixture, not config.
const DEAD_REGISTRY_FIXTURE = '0x48e0c3c72033d287f8d9046226dbf8fb64c2ecdbca6bc7fba665d95288f79591'

const LIVE = process.env.ARES_SKIP_LIVE !== '1'
const d = LIVE ? describe : describe.skip
const NET_TIMEOUT = 60_000

d('D105 live gRPC wrapper regression (testnet)', () => {
  /** @type {Awaited<ReturnType<typeof get_sdk>>} */
  let sdk

  beforeAll(async () => {
    sdk = await get_sdk()
  }, NET_TIMEOUT)

  it(
    'getObject(shared registry fixture) → `{ object }` wrapper unwraps to json + BigInt-able version',
    async () => {
      // The RAW `{ object }` wrapper shape every chain-direct read destructures. A re-migration that changes
      // the envelope (json/version moving, re-nesting) reds these asserts before any consumer ships on it.
      const { object } = await sdk.grpc_client.core.getObject({
        objectId: DEAD_REGISTRY_FIXTURE,
        include: { json: true },
      })
      expect(object).toBeDefined()
      expect(object.objectId).toBe(DEAD_REGISTRY_FIXTURE)
      expect(object.json).toBeDefined()
      expect(() => BigInt(object.version)).not.toThrow()
      expect(BigInt(object.version) > 0n).toBe(true)
      // the registry's own decoded payload — an array field proves json decoded past the wrapper
      expect(Array.isArray(object.json?.dungeons)).toBe(true)
    },
    NET_TIMEOUT
  )

  it(
    'get_owned_items(addr) → array (kiosk-union consumer smoke — getOwnedKiosks/getKiosk/getObject wrappers)',
    async () => {
      // Any address is fine: get_owned_items now UNIONS Items locked across the wallet's personal kiosks (every
      // item is kiosk-locked). A package address owns no PersonalKioskCap → getOwnedKiosks returns [] → [] (not
      // throws). Proves the kiosk-walk wrappers unwrap; a regression (e.g. `.items` off an undefined kiosk) throws.
      // Inject a /v1-down fetcher so this smoke keeps exercising the chain-walk FALLBACK (its whole point) instead
      // of short-circuiting through /v1 (get_owned_items is /v1-first now).
      const items = await get_owned_items(sdk, PACKAGE_ID, PACKAGE_ID, () => Promise.reject(new Error('force walk')))
      expect(Array.isArray(items)).toBe(true)
    },
    NET_TIMEOUT
  )
})
