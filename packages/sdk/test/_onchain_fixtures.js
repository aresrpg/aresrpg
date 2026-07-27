// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared fixtures + helpers for the on-chain builder tests. Offline only: a full placeholder id set for THE merged
// `aresrpg` package (injected via `context.ids.aresrpg` — the deployment override seam) so every PTB BUILDS without
// a live publish, plus a `move_calls` inspector over `tx.getData()` to assert targets + arg shapes, and a
// kiosk-client stub for the borrow-val dance. The S-46 merge collapsed the six per-package id sets into this ONE
// block (deployment/aresrpg.js) — the repo map ships EMPTY until the merged-package ceremony stamps it, so both
// DEPLOYED and UNDEPLOYED states are manufactured through the seam, never read off the repo's stamp state.

/** A deterministic, well-formed 32-byte object id from an ARBITRARY tag (hex-encoded so any letters are valid),
 *  e.g. `id('pool')`. Distinct tags → distinct ids. */
export const id = tag =>
  `0x${Array.from(String(tag))
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64)}`

/** The FULL merged-package id block — key set mirrors src/deployment/aresrpg.js (every key, not just REQUIRED —
 *  the non-required singleton guards need real values here and '' in the bare variants). */
export const IDS = {
  aresrpg: {
    PACKAGE_ID: id('a5e0'),
    LATEST_PACKAGE_ID: id('a5ef'),
    // The DIET manifest pin (advisor pass-67): its presence is what lets create_fight_ptb compose the cheap
    // proof door at all — the EMPTY_IDS variant manufactures the unstamped old-door-only polarity.
    ZONE_GROUP_ROOT_PACKAGE_ID: id('a5zr'),
    FOUNDATION_PACKAGE_ID: id('f0e0'),
    ENGINE_PACKAGE_ID: id('e0e0'),
    ENGINE_LATEST_PACKAGE_ID: id('e0ef'),
    ENGINE_VERSION: id('e0e1'),
    SPELLS_PACKAGE_ID: id('5be0'),
    SPELLS_VERSION: id('5be1'),
    SOCIAL_PACKAGE_ID: id('50c0'),
    SOCIAL_LATEST_PACKAGE_ID: id('50cf'),
    SOCIAL_VERSION: id('50c1'),
    SOCIAL_FRIEND_REGISTRY: id('50c2'),
    KOLIZEUM_PACKAGE_ID: id('ko1z'),
    FORGEMAGIE_PACKAGE_ID: id('f09e'),
    GIFTING_PACKAGE_ID: id('gift'),
    DUNGEON_PACKAGE_ID: id('dngn'),
    VERSION: id('a501'),
    GAME_CONFIG: id('a5c0'),
    CREATION: id('a5cr'),
    CATALOG: id('a5ca'),
    // One row per registry shard, index order — the ceremony's stamp shape (see `fight_registry_arg`).
    FIGHT_REGISTRY_SHARDS: Array.from({ length: 16 }, (_, i) => ({
      id: id(`a5fr${i.toString(16)}`),
      initial_shared_version: '1',
    })),
    POOL_REGISTRY: id('a5pr'),
    ITEM_POLICY: id('a5b0'),
    CHARACTER_POLICY: id('a5b1'),
    KIOSK_ROYALTY_RULE_PACKAGE_ID: id('a5kr'),
    EXTRACT_POLICY: id('a5xp'),
    CHARACTER_EXTRACT_POLICY: id('a5cx'),
    SCRIBE_CONFIG: id('a5sc'),
    PET_FEED_CONFIG: id('a5pf'),
    LOOT_REGISTRY: id('a5lr'),
    ITEM_ROYALTY_MIN_MIST: '10000000', // stamped floor fixture (0.01 SUI — matches ceremony_lib.mjs's ROYALTY_MIN)
  },
}

/** Every deployment key emptied — injected to MANUFACTURE the undeployed state through the override seam. */
const empty = keys => Object.fromEntries(keys.map(key => [key, '']))
export const EMPTY_IDS = {
  aresrpg: empty(Object.keys(IDS.aresrpg)),
}

/** Kiosk-client stub for the context's READ client. `borrow_personal_kiosk_cap` no longer calls
 *  `.getRulePackageId` on this directly (S-71c kiosk-rule-linkage fix) — it wraps it through its own
 *  KIOSK_ROYALTY_RULE_PACKAGE_ID linkage seam, so `.client` (undefined here — harmless, never dereferenced
 *  offline) is what actually rides through; `.getRulePackageId` only survives as the pre-ceremony/no-fork
 *  fallback (a network with an unstamped KIOSK_ROYALTY_RULE_PACKAGE_ID). */
export const stub_kiosk_client = {
  getRulePackageId: () => id('9ec0'),
}

/** A DEPLOYED context (full injected ids) — builders resolve + build. */
export const deployed_context = {
  network: 'testnet',
  kiosk_client: stub_kiosk_client,
  ids: IDS,
}

/** An UNDEPLOYED context (all ids emptied via the seam) — builders must refuse loudly. */
export const undeployed_context = {
  network: 'testnet',
  kiosk_client: stub_kiosk_client,
  ids: EMPTY_IDS,
}

/** Flatten a built tx's MoveCall commands to `{ package, target: 'module::function', args, types }`. */
export function move_calls(tx) {
  return tx
    .getData()
    .commands.filter(c => c.$kind === 'MoveCall')
    .map(c => ({
      package: c.MoveCall.package,
      target: `${c.MoveCall.module}::${c.MoveCall.function}`,
      args: c.MoveCall.arguments.length,
      types: c.MoveCall.typeArguments,
    }))
}

/** The list of `module::function` targets in order. */
export const targets = tx => move_calls(tx).map(c => c.target)

/** The first MoveCall whose target is `module::function`, or undefined. */
export const find_call = (tx, target) =>
  move_calls(tx).find(c => c.target === target)
