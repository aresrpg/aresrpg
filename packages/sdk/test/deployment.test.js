// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEPLOYMENT TEST (S-51a) — proves aresrpg_shared_ref resolves a static {objectId, initialSharedVersion,
// mutable} pair OFFLINE via the injection seam (mirrors aresrpg_deployment's `overrides`), and refuses
// rather than guesses when data is missing or `mutable` isn't stated explicitly by the caller.
import { test, expect } from 'bun:test'

import {
  aresrpg_deployment,
  aresrpg_shared_ref,
} from '../src/deployment/aresrpg.js'

test('aresrpg_shared_ref: resolves fully from injected overrides — no dependency on stamped network data', () => {
  const ref = aresrpg_shared_ref('testnet', 'GAME_CONFIG', false, {
    objectId: '0xfake-object',
    initialSharedVersion: '42',
  })
  expect(ref).toEqual({
    objectId: '0xfake-object',
    initialSharedVersion: '42',
    mutable: false,
  })
})

test('aresrpg_shared_ref: mutable is caller-stated, never inferred — true and false both pass through verbatim', () => {
  const overrides = { objectId: '0xfake', initialSharedVersion: '1' }
  expect(
    aresrpg_shared_ref('testnet', 'FIGHT_REGISTRY', true, overrides).mutable,
  ).toBe(true)
  expect(
    aresrpg_shared_ref('testnet', 'FIGHT_REGISTRY', false, overrides).mutable,
  ).toBe(false)
})

test('aresrpg_shared_ref: throws when mutable is omitted or not a real boolean — refuses to guess', () => {
  const overrides = { objectId: '0xfake', initialSharedVersion: '1' }
  expect(() =>
    aresrpg_shared_ref('testnet', 'GAME_CONFIG', undefined, overrides),
  ).toThrow(/mutable/)
  expect(() =>
    aresrpg_shared_ref('testnet', 'GAME_CONFIG', 'true', overrides),
  ).toThrow(/mutable/)
})

test('aresrpg_shared_ref: throws when the key is unstamped for the network and no override supplies it', () => {
  expect(() => aresrpg_shared_ref('mainnet', 'GAME_CONFIG', false)).toThrow(
    /not stamped/,
  )
})

test('aresrpg_shared_ref: a partial override (objectId only) still refuses — never half-guesses the pair', () => {
  expect(() =>
    aresrpg_shared_ref('mainnet', 'GAME_CONFIG', false, { objectId: '0xfake' }),
  ).toThrow(/not stamped/)
})

test('aresrpg_shared_ref: without overrides, resolves from the real ceremony-stamped testnet map', () => {
  const ref = aresrpg_shared_ref('testnet', 'FIGHT_REGISTRY', true)
  expect(ref.objectId).toMatch(/^0x[0-9a-f]{64}$/)
  expect(ref.initialSharedVersion).toMatch(/^\d+$/)
  expect(ref.mutable).toBe(true)
})

// ── LOCALNET RESOLUTION — an UNKNOWN network (no baked map) resolves ENTIRELY from the injected override
// (`context.ids.aresrpg`, the localnet bot seam). A bare unknown network with NO injection still REFUSES loudly
// (a typo must never yield an empty deployment), a PARTIAL injection still trips the REQUIRED_IDS gate, and
// testnet/mainnet stay byte-identical (their baked map is untouched).

// A full localnet-shaped id set — every REQUIRED_ID present, mirroring the bot manifest's `ids.aresrpg`.
const LOCALNET_FULL = {
  PACKAGE_ID: '0xpkg',
  LATEST_PACKAGE_ID: '0xlatest',
  ENGINE_LATEST_PACKAGE_ID: '0xenginelatest',
  VERSION: '0xversion',
  GAME_CONFIG: '0xgameconfig',
  CREATION: '0xcreation',
  CATALOG: '0xcatalog',
  FIGHT_REGISTRY: '0xfightreg',
  POOL_REGISTRY: '0xpoolreg',
  ITEM_POLICY: '0xitempolicy',
  CHARACTER_POLICY: '0xcharpolicy',
}

test('aresrpg_deployment: localnet + FULL override resolves entirely from context.ids — no baked map required', () => {
  const a = aresrpg_deployment('localnet', LOCALNET_FULL)
  expect(a.network).toBe('localnet')
  expect(a.PACKAGE_ID).toBe('0xpkg')
  expect(a.CHARACTER_POLICY).toBe('0xcharpolicy')
})

test('aresrpg_deployment: localnet WITHOUT override still fails loudly — an unknown network never yields an empty deployment', () => {
  expect(() => aresrpg_deployment('localnet')).toThrow(
    /no aresrpg ids for network "localnet"/,
  )
})

test('aresrpg_deployment: localnet + PARTIAL override still refuses at the REQUIRED_IDS gate — a half-injection never silently resolves', () => {
  expect(() =>
    aresrpg_deployment('localnet', { PACKAGE_ID: '0xpkg' }),
  ).toThrow(/unset ids/)
})

test('aresrpg_deployment: testnet stays byte-identical — the baked map still resolves with no override', () => {
  const a = aresrpg_deployment('testnet')
  expect(a.network).toBe('testnet')
  expect(a.PACKAGE_ID).toMatch(/^0x[0-9a-f]{64}$/)
})

test('aresrpg_shared_ref: localnet + FULL pair (objectId + initialSharedVersion) resolves the static ref offline', () => {
  const ref = aresrpg_shared_ref('localnet', 'VERSION', false, {
    objectId: '0xver',
    initialSharedVersion: '3',
  })
  expect(ref).toEqual({
    objectId: '0xver',
    initialSharedVersion: '3',
    mutable: false,
  })
})

test('aresrpg_shared_ref: localnet objectId-only (no baked map) returns null — caller falls back to tx.object(id), mirrors random_shared_ref', () => {
  expect(
    aresrpg_shared_ref('localnet', 'VERSION', false, { objectId: '0xver' }),
  ).toBeNull()
  // Contrast with a STAMPED network: a missing stamp there still THROWS (incomplete ceremony must never
  // silently degrade) — see the 'partial override (objectId only) still refuses' mainnet case above.
})
