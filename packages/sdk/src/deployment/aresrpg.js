// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ARESRPG DEPLOYMENT — THE single SDK home for the merged `aresrpg` package (S-46: the 8 per-package
// lineages — items/game/fight/dungeon/kolizeum/pools/spells/social — collapsed into ONE package) plus its
// `aresrpg_foundation` math-library dependency. The six per-domain files under src/deployment/ are
// back-compat shims re-exporting THIS resolver; release.json is the one checked-in deployment config.
//
// A network row stays empty until the publish ceremony atomically writes it. The accessor THROWS LOUDLY on
// any unset required id — nothing routes to a half-deployed package. Resolution is LAZY (call-time), never
// at SDK construction, so an unconfigured network never breaks the SDK — only an actual call against it
// refuses.
//
// `overrides` is the injection seam: a caller — or an offline test — passes a full id set
// (`context.ids.aresrpg`) to build a PTB without a live publish. Omitted in production, so real
// callers always get the stamp-or-throw behaviour.

import RELEASE from './release.json' with { type: 'json' }

// STATIC historical compatibility data, not per-publish pins. stamp_all preserves the constants block;
// append new legacy template identities when needed, never replace an existing mapping.
export const legacy_cosmetic_variants =
  RELEASE.networks?.testnet?.constants?.legacy_cosmetic_variants ?? {}

/**
 * One stamped shared object: its id plus the version it was shared at (what a static `SharedObjectRef` needs).
 * @typedef {Object} SharedPin
 * @property {string} id
 * @property {string} initial_shared_version
 */

/**
 * @typedef {Object} AresrpgIds
 * @property {string} PACKAGE_ID            Type-origin id — every struct identity (event filters, kiosk item types).
 * @property {string} LATEST_PACKAGE_ID     Call target — every moveCall targets this; bumped by each `sui client upgrade`.
 * @property {string} ZONE_GROUP_ROOT_PACKAGE_ID Immutable type origin for `zones::ZoneGroupRootKey`, introduced
 *                                          by the fight-create compute-diet upgrade. Non-required until that upgrade.
 * @property {string} FOUNDATION_PACKAGE_ID `aresrpg_foundation` (stateless math lib) — hosts `item_stats::new`
 *                                          (the ItemStatistics constructor scribe encodes with). Non-required.
 * @property {string} ENGINE_PACKAGE_ID     `aresrpg_fight` TYPE ORIGIN — Fight/FightOutcome/event type strings
 *                                          originate here, frozen at first publish (S-68 split it from the call target).
 * @property {string} ENGINE_LATEST_PACKAGE_ID `aresrpg_fight` CALL TARGET — every turns::/actions::/settlement::
 *                                          moveCall targets this; bumped by each engine `sui client upgrade`.
 * @property {string} ENGINE_VERSION        The engine package's shared `version::Version` (crank/actions pass it).
 * @property {string} SPELLS_PACKAGE_ID     `aresrpg_spells` — SpellTemplate shared objects (cast PTBs reference).
 * @property {string} SPELLS_VERSION        The spells package's shared Version (admin tuning passes it).
 * @property {string} SOCIAL_PACKAGE_ID     `aresrpg_social` TYPE ORIGIN — frozen event/object identity.
 * @property {string} SOCIAL_LATEST_PACKAGE_ID `aresrpg_social` CALL TARGET — bumped by each social upgrade.
 * @property {string} SOCIAL_VERSION        The social package's shared Version.
 * @property {string} SOCIAL_FRIEND_REGISTRY Shared `friends::FriendRegistry` (derived-object parent — one FriendList
 *                                          per address; `create_friend_list` only). Non-required.
 * @property {string} KOLIZEUM_PACKAGE_ID   `aresrpg_kolizeum` — the sibling PvP-arena package (package-split
 *                                          2026-07-11; own-branded on the generic engine). CALL TARGET for every
 *                                          `kolizeum::*` moveCall (create/join/exit/cancel/sweep/start/seat/settle/
 *                                          open). Has NO own Version (uses core VERSION + engine ENGINE_VERSION).
 *                                          Non-required: the create/fight/pool core builds without it; the kolizeum
 *                                          builders guard the id they target (refuse loudly if unstamped).
 * @property {string} FORGEMAGIE_PACKAGE_ID `aresrpg_forgemagie` — the sibling Retro rune-forge package (package-
 *                                          split 2026-07-12; extracted from core at the 102,400 B publish cap).
 *                                          CALL TARGET for every `forgemagie::*` moveCall (`scribe_rune` / `crush`).
 *                                          Has NO own Version/config — passes CORE's VERSION + GameConfig + policies
 *                                          + the seed CrushBoard as runtime args. Non-required: the create/fight/pool
 *                                          core builds without it; the scribe/crush builders guard it (refuse if unstamped).
 * @property {string} GIFTING_PACKAGE_ID    `aresrpg_gifting` — the sibling gift/airdrop/loot_box/consume/pool/creation
 *                                          package (package-split 2026-07-13). CALL TARGET for those moveCalls; passes
 *                                          CORE's VERSION + GameConfig + policies as runtime args. Non-required (guarded).
 * @property {string} DUNGEON_PACKAGE_ID    `aresrpg_dungeon` — the sibling dungeon/run/dungeon_events package (package-
 *                                          split 2026-07-13). CALL TARGET for `dungeon::*` moveCalls. Non-required (guarded).
 * @property {string} VERSION               THE ONE shared `version::Version` (the 8 per-package Versions died in the
 *                                          merge; `ItemsVersion`/`FightVersion` params are aliases of this same object).
 * @property {string} GAME_CONFIG           Shared `config::GameConfig` (dials: max level, multipliers, gates).
 * @property {string} CREATION              Shared `creation::Creation` gate (character mint door + name registry).
 * @property {string} CATALOG               Shared `catalog::Catalog` (admin category whitelist).
 * @property {SharedPin[]} FIGHT_REGISTRY_SHARDS  The `fight_registry::FightRegistry` SHARD LIST, index-ordered
 *                                          (`init` shares one registry per shard so fight entry and exit stop
 *                                          contending globally). A scope's shard is `fight_shard_index(scope)`;
 *                                          pick with `fight_registry_arg`, never by hand. THE CEREMONY HAND-OFF:
 *                                          the stamp step writes these rows where it used to write the single
 *                                          `FIGHT_REGISTRY` id — one row per shard, in index order, each with its
 *                                          own `initial_shared_version`. Length must equal `FIGHT_SHARD_COUNT`.
 * @property {SharedPin[]} FIGHT_LATCH_SHARDS The parallel `fight_latch::FightLatch` SHARD LIST, index-ordered.
 *                                          A character's shard is selected by the SAME `fight_shard_index`
 *                                          function as registries. These remain distinct shared objects even
 *                                          when the scope and character indexes happen to match.
 * @property {string} POOL_REGISTRY         Shared `pool::PoolRegistry` (pool derivation parent; cap fields died).
 * @property {string} ITEM_POLICY           `TransferPolicy<Item>` — every item mint locks through it.
 * @property {string} CHARACTER_POLICY      `TransferPolicy<Character>` — creation locks the character through it.
 * @property {string} KIOSK_ROYALTY_RULE_PACKAGE_ID  The FORKED kiosk-rules package the base policies' rules live
 *                                          on, at its UPGRADED (latest) id — royalty_rule::pay/fee_amount and
 *                                          kiosk_lock_rule::prove MUST be CALLED here or a marketplace buy aborts
 *                                          InvalidLinkage (kiosk-rule-linkage law: the call target is the id the
 *                                          core package's own linkage table binds — derivable on-chain, stamped at
 *                                          the ceremony from manifest `_rules`). A package id (never shared).
 *                                          Non-required: marketplace buys guard it themselves.
 * @property {string} EXTRACT_POLICY        Shared wrapped `extract::ItemExtractPolicy` (ceremony W3) — the
 *                                          permanently-empty extraction policy every equip/burn/craft/pool-sell/
 *                                          feed/crush/scribe/dungeon-activate passes. Non-required.
 * @property {string} CHARACTER_EXTRACT_POLICY Shared wrapped `character_extract::CharacterExtractPolicy` — the
 *                                          permanently-empty CHARACTER extraction policy the delete door passes —
 *                                          it enforces unequipped-only character delete. Stamped by the
 *                                          upgrade ceremony (`create_character_extract_policy`). Non-required:
 *                                          only delete_character_ptb needs it, and it guards the id itself.
 * @property {string} SCRIBE_CONFIG         Shared `scribe::ScribeConfig` (per-level stat bands — scribe only). Non-required.
 * @property {string} PET_FEED_CONFIG       Shared `pet::PetFeedConfig` (food→power table — pet feed only). Non-required.
 * @property {string} CRUSH_BOARD           Shared `forgemagie::CrushBoard` (rune registry — scribe/crush only). A
 *                                          SEED object minted by `packages/move/scripts/qa/board_bootstrap.mjs`
 *                                          AFTER publish and retained in the release config until replaced.
 *                                          Non-required.
 * @property {string} LOOT_REGISTRY         Shared `loot_box::LootRegistry` (box template id → weighted pet pool —
 *                                          lootbox open_box only). Non-required (only open_box_ptb needs it).
 * @property {string} ITEM_ROYALTY_MIN_MIST Per-item royalty floor (MIST) off the ITEM_POLICY's royalty_rule
 *                                          Config `min_amount` — the gift feature's escrow-funding constant,
 *                                          stamped like every other deployment id: a build-time value
 *                                          recorded by the ceremony-owned release config, never a runtime call.
 *                                          Non-required: only gift_send_ptb needs it, and
 *                                          it guards the value itself (refuses loudly if unstamped/zero).
 */

/**
 * Derive the SDK's stable flat API from the semantic release row. The JSON is the only
 * checked-in deployment-id home; this mapping contains paths, never copied values.
 * @param {any} release
 * @returns {AresrpgIds}
 */
export function sdk_ids_from_release(release) {
  const packages = release?.packages ?? {}
  const shared = release?.shared ?? {}
  const policies = release?.policies ?? {}
  return {
    PACKAGE_ID: packages.aresrpg?.origin ?? '',
    LATEST_PACKAGE_ID: packages.aresrpg?.latest ?? '',
    ZONE_GROUP_ROOT_PACKAGE_ID: release?.type_origins?.zone_group_root ?? '',
    FOUNDATION_PACKAGE_ID: packages.foundation?.latest ?? '',
    ENGINE_PACKAGE_ID: packages.engine?.origin ?? '',
    ENGINE_LATEST_PACKAGE_ID: packages.engine?.latest ?? '',
    ENGINE_VERSION: shared.ENGINE_VERSION?.id ?? '',
    SPELLS_PACKAGE_ID: packages.spells?.origin ?? '',
    SPELLS_VERSION: shared.SPELLS_VERSION?.id ?? '',
    SOCIAL_PACKAGE_ID: packages.social?.origin ?? '',
    SOCIAL_LATEST_PACKAGE_ID: packages.social?.latest ?? '',
    SOCIAL_VERSION: shared.SOCIAL_VERSION?.id ?? '',
    SOCIAL_FRIEND_REGISTRY: shared.SOCIAL_FRIEND_REGISTRY?.id ?? '',
    KOLIZEUM_PACKAGE_ID: packages.kolizeum?.latest ?? '',
    FORGEMAGIE_PACKAGE_ID: packages.forgemagie?.latest ?? '',
    GIFTING_PACKAGE_ID: packages.gifting?.latest ?? '',
    DUNGEON_PACKAGE_ID: packages.dungeon?.latest ?? '',
    VERSION: shared.VERSION?.id ?? '',
    GAME_CONFIG: shared.GAME_CONFIG?.id ?? '',
    CREATION: shared.CREATION?.id ?? '',
    CATALOG: shared.CATALOG?.id ?? '',
    FIGHT_REGISTRY_SHARDS: (shared.FIGHT_REGISTRY_SHARDS ?? []).map(
      /** @param {any} row */ row => ({
        id: row?.id ?? '',
        initial_shared_version: row?.initial_shared_version ?? '',
      }),
    ),
    FIGHT_LATCH_SHARDS: (shared.FIGHT_LATCH_SHARDS ?? []).map(
      /** @param {any} row */ row => ({
        id: row?.id ?? '',
        initial_shared_version: row?.initial_shared_version ?? '',
      }),
    ),
    POOL_REGISTRY: shared.POOL_REGISTRY?.id ?? '',
    ITEM_POLICY: policies.item?.id ?? '',
    CHARACTER_POLICY: policies.character?.id ?? '',
    KIOSK_ROYALTY_RULE_PACKAGE_ID: release?.rules_package ?? '',
    EXTRACT_POLICY: policies.extract?.id ?? '',
    CHARACTER_EXTRACT_POLICY: policies.character_extract?.id ?? '',
    SCRIBE_CONFIG: shared.SCRIBE_CONFIG?.id ?? '',
    PET_FEED_CONFIG: shared.PET_FEED_CONFIG?.id ?? '',
    CRUSH_BOARD: shared.CRUSH_BOARD?.id ?? '',
    LOOT_REGISTRY: shared.LOOT_REGISTRY?.id ?? '',
    ITEM_ROYALTY_MIN_MIST: release?.constants?.item_royalty_min_mist ?? '',
  }
}

/** @param {string} network */
export function release_network(network) {
  return RELEASE.networks?.[network] ?? null
}

/**
 * LOCALNET reads runtime-injected ids because they regenerate on every genesis. Tracked
 * testnet/mainnet deployments derive directly from release.json.
 * @param {string} network
 * @returns {AresrpgIds | null}
 */
function ids_for(network) {
  if (network === 'localnet')
    return (
      (typeof globalThis !== 'undefined' &&
        /** @type {{ __ARES_LOCALNET_IDS?: AresrpgIds }} */ (globalThis)
          .__ARES_LOCALNET_IDS) ||
      null
    )
  const release = release_network(network)
  return release ? sdk_ids_from_release(release) : null
}

/** @param {string} network */
function shared_versions_for(network) {
  const release = release_network(network)
  if (!release) return null
  const versions = Object.fromEntries(
    Object.entries(release.shared ?? {}).map(([key, value]) => [
      key,
      /** @type {{ initial_shared_version?: string }} */ (value)
        .initial_shared_version ?? '',
    ]),
  )
  versions.ITEM_POLICY = release.policies?.item?.initial_shared_version ?? ''
  versions.CHARACTER_POLICY =
    release.policies?.character?.initial_shared_version ?? ''
  versions.EXTRACT_POLICY =
    release.policies?.extract?.initial_shared_version ?? ''
  versions.CHARACTER_EXTRACT_POLICY =
    release.policies?.character_extract?.initial_shared_version ?? ''
  return versions
}

/**
 * A static Random shared reference, or null when the network has no release pin.
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @returns {{ objectId: string, initialSharedVersion: string, mutable: false } | null}
 */
export function random_shared_ref(network) {
  const random = release_network(network)?.system?.random
  return random?.id && random?.initial_shared_version
    ? {
        objectId: random.id,
        initialSharedVersion: random.initial_shared_version,
        mutable: false,
      }
    : null
}

// The ids no core flow can build without. FOUNDATION_PACKAGE_ID / SCRIBE_CONFIG / PET_FEED_CONFIG /
// CRUSH_BOARD are intentionally NOT required — only the scribe/feed/crush builders need
// them, and each guards the specific id it touches (an unset singleton must never block the create/shop/fight/pool core).
// FIGHT_REGISTRY_SHARDS rides the same rule: it is guarded at the point of use by `fight_registry_arg`, which
// refuses loudly and by name rather than letting a fight PTB build against a guessed shard.
const REQUIRED_IDS = [
  'PACKAGE_ID',
  'LATEST_PACKAGE_ID',
  'ENGINE_LATEST_PACKAGE_ID',
  'VERSION',
  'GAME_CONFIG',
  'CREATION',
  'CATALOG',
  'POOL_REGISTRY',
  'ITEM_POLICY',
  'CHARACTER_POLICY',
]

/**
 * Read ONE aresrpg id WITHOUT the full-deployment gate — returns '' if unset or the network is unknown. For
 * READ paths that need a single id (a type string for an owned-object scan, a shared registry) and must work
 * even before the package is publish-complete (e.g. VERSION still unstamped). Never throws — the caller checks
 * the '' itself. Write paths keep using `aresrpg_deployment` (the all-or-nothing stamp-or-throw gate).
 * SCALAR pins only. The list-shaped one (the registry shards) has its own reader, `fight_registry_arg`, which
 * picks by scope — there is no single id to hand back for it.
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {Exclude<keyof AresrpgIds, 'FIGHT_REGISTRY_SHARDS' | 'FIGHT_LATCH_SHARDS'>} key
 * @returns {string}
 */
export function aresrpg_id(network, key) {
  return ids_for(network)?.[key] ?? ''
}

/**
 * True when every REQUIRED id for `network` is populated (post-ceremony). The single gate a consumer checks
 * before routing to any on-chain flow — while false, callers keep their pre-ceremony behaviour.
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @returns {boolean}
 */
export function aresrpg_deployment_ready(network) {
  const ids = ids_for(network)
  return !!ids && REQUIRED_IDS.every(key => !!ids[key])
}

/**
 * Resolve the `aresrpg` ids for `network`, THROWING LOUDLY if the package is not (fully) deployed there.
 * Call-time only (never at SDK construction) so an un-stamped network never breaks the SDK — only an actual
 * call against it refuses. This is the "refuse, never guess" gate: no builder invents an id.
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {Partial<AresrpgIds>} [overrides] full/partial id set merged OVER the network ids (test / injection
 *   seam — `context.ids.aresrpg`; omit in production so real callers always get stamp-or-throw).
 * @returns {AresrpgIds & { network: string }}
 */
export function aresrpg_deployment(network, overrides = {}) {
  const base = ids_for(network)
  // An unknown network with NO injected override still refuses loudly — a typo must never yield an empty
  // deployment. A caller-supplied override (a fresh/localnet publish via `context.ids`) stands in for a
  // missing baked map: it flows through the REQUIRED_IDS gate below, so a PARTIAL injection still throws there.
  if (!base && !Object.keys(overrides).length)
    throw new Error(
      `[aresrpg_deployment] no aresrpg ids for network "${network}" — only ${Object.keys(RELEASE.networks ?? {}).join('/')} are stamped.`,
    )

  const ids = { ...base, ...overrides }
  // An id is unset when falsy; a LIST-shaped pin (the registry shards) is unset when it is empty — an empty
  // array is truthy and would otherwise sail through the gate and fail later, at the call site.
  const missing = REQUIRED_IDS.filter(key =>
    Array.isArray(ids[key]) ? !ids[key].length : !ids[key],
  )
  if (missing.length)
    throw new Error(
      `[aresrpg_deployment] aresrpg is not deployed on "${network}" — unset ids: ${missing.join(
        ', ',
      )}. Run the publish ceremony to stamp src/deployment/release.json before any call.`,
    )

  return { network, ...ids }
}

/**
 * @typedef {Object} SharedRef
 * @property {string} objectId              The shared object's id (same value `aresrpg_id` returns for `key`).
 * @property {string} initialSharedVersion  Frozen at share-time — the exact value Sui's SharedObjectRef needs.
 * @property {boolean} mutable              Whatever the CALLER passed in — never inferred by this helper.
 */

/**
 * Resolve a STATIC SharedObjectRef-shaped pair `{ objectId, initialSharedVersion }` for one shared object,
 * so a PTB can skip the `client.getObject` round-trip tx-build would otherwise pay to resolve it (S-51a —
 * the measured biggest per-tx latency win; a fight touches ~6 shared objects). THROWS LOUDLY if `key` isn't
 * stamped for `network` — refuse, never guess, same gate as `aresrpg_deployment`.
 *
 * `mutable` is NEVER inferred here: the same shared object can be read in one PTB and mutated in another,
 * so only the call site knows which — pass it explicitly every time.
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {string} key one of the shared-object keys in SHARED_VERSIONS (e.g. 'GAME_CONFIG', 'FIGHT_REGISTRY')
 * @param {boolean} mutable whether THIS call site mutates the object — caller-supplied, required
 * @param {{ objectId?: string, initialSharedVersion?: string }} [overrides] test / injection seam (same
 *   philosophy as `aresrpg_deployment`'s `overrides`) — supply both to resolve fully offline.
 * @returns {SharedRef | null} the static ref, or null when the network has NO baked version map (a fresh /
 *   localnet publish) and only an id was supplied — mirrors `random_shared_ref`; the caller then falls back to
 *   the unresolved `tx.object(id)` (client resolves at build). testnet/mainnet never take this path.
 */
export function aresrpg_shared_ref(network, key, mutable, overrides = {}) {
  if (typeof mutable !== 'boolean')
    throw new Error(
      `[aresrpg_shared_ref] mutable must be an explicit boolean for "${key}" (got ${typeof mutable}) — the caller states mutability per call-site, it is never guessed.`,
    )

  const shared_versions = shared_versions_for(network)
  const object_id = overrides.objectId ?? ids_for(network)?.[key] ?? ''
  const initial_shared_version =
    overrides.initialSharedVersion ?? shared_versions?.[key] ?? ''

  // Fresh/unstamped network (a localnet publish has NO baked SHARED_VERSIONS map): the caller gave the id but
  // there is no version to PIN, so signal "unresolved" with null exactly like `random_shared_ref` — the caller
  // falls back to `tx.object(id)` and the client resolves it at build. A network that HAS a baked map
  // (testnet/mainnet) still REFUSES loudly on a missing stamp below: an incomplete ceremony must never degrade.
  if (object_id && !initial_shared_version && !shared_versions) return null

  if (!object_id || !initial_shared_version)
    throw new Error(
      `[aresrpg_shared_ref] "${key}" is not stamped for "${network}" — objectId=${JSON.stringify(object_id)} initialSharedVersion=${JSON.stringify(initial_shared_version)}. Stamp the ceremony (or pass overrides) before requesting a static ref.`,
    )

  // Returned keys stay camelCase on purpose — this shape is meant to be spread straight into
  // @mysten/sui's `Inputs.SharedObjectRef({ objectId, mutable, initialSharedVersion })`.
  return {
    objectId: object_id,
    initialSharedVersion: initial_shared_version,
    mutable,
  }
}

/**
 * Place a deployment SINGLETON shared object as a transaction argument, null-guarded for a fresh/localnet
 * publish. Resolves the STATIC SharedObjectRef via `aresrpg_shared_ref` (testnet/mainnet: zero resolve
 * round-trip) and passes it to `tx.sharedObjectRef`. When that returns null — a network with NO baked
 * SHARED_VERSIONS map (a localnet publish supplies the id via `context.ids.aresrpg` but no
 * initial_shared_version to pin) — it falls back to the UNRESOLVED `tx.object(object_id)` (the client resolves
 * it at build), EXACTLY as `random_arg` falls back to `tx.object.random()`. BYTE-IDENTICAL to the bare
 * `tx.sharedObjectRef(ref)` whenever a ref resolves, so testnet/mainnet PTBs are unchanged — the fallback only
 * ever fires on an unstamped network. Takes `tx` as a parameter (never imports @mysten/sui) so this module stays
 * dependency-clean, mirroring the ref-returning `random_shared_ref`/`aresrpg_shared_ref`.
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {string} key one of the SHARED_VERSIONS keys (e.g. 'VERSION', 'GAME_CONFIG')
 * @param {boolean} mutable whether THIS call-site mutates the object — caller-supplied, required (as `aresrpg_shared_ref`)
 * @param {string} object_id the shared object's id (from the resolved deployment, e.g. `a.VERSION`)
 * @returns {ReturnType<import('@mysten/sui/transactions').Transaction['object']>}
 */
export function shared_object_arg(tx, network, key, mutable, object_id) {
  const ref = aresrpg_shared_ref(network, key, mutable, { objectId: object_id })
  return ref ? tx.sharedObjectRef(ref) : tx.object(object_id)
}

/**
 * How many `FightRegistry` shards `fight_registry::init` shares. MUST equal the Move `SHARD_COUNT` — the two
 * are one fact with two homes by necessity (the client picks the shard, the chain asserts it), and a mismatch
 * shows up as an `EWrongShard` abort on every create.
 */
export const FIGHT_SHARD_COUNT = 16

/**
 * The shard index shared by both parallel fight families — the JS twin of Move's
 * `fight_registry::shard_index`: the LAST BYTE of the scope id, modulo the shard count. The last two hex
 * characters of an object id ARE that byte whatever the string's leading-zero form, so this needs no address
 * normalisation and no hash to keep byte-identical with the chain.
 *
 * The scope is whatever the fight derives from: the WORLD id for world fights, the RUN PASS id for a dungeon
 * room, the LOBBY id for a kolizeum match. Accepts the same two forms every object-taking builder accepts — a
 * bare id string, or a caller-CACHED `SharedObjectRef` (the S-51a round-trip saver) whose `objectId` is the id.
 * @param {string | { objectId?: string }} scope
 * @returns {number}
 */
export function fight_shard_index(scope) {
  const raw =
    scope && typeof scope === 'object' ? (scope.objectId ?? '') : scope
  const hex = String(raw).replace(/^0x/i, '')
  if (!/^[0-9a-f]+$/i.test(hex))
    throw new Error(
      `[fight_shard_index] scope must be a hex object id (or a shared ref carrying one), got ${JSON.stringify(scope)} — the shard is derived from its bytes, never guessed.`,
    )
  return parseInt(hex.slice(-2), 16) % FIGHT_SHARD_COUNT
}

/**
 * Place the `FightRegistry` SHARD a scope maps to as a transaction argument. Every door that used to take the
 * single registry takes its shard instead, and the chain asserts the mapping — passing the wrong one aborts, so
 * this is the only correct way to build the argument.
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {AresrpgIds} a resolved deployment ids
 * @param {string | { objectId?: string }} scope the fight's derivation scope (world / run pass / lobby id, or a cached ref)
 * @param {boolean} mutable whether THIS call site mutates the registry — caller-supplied, never guessed
 * @returns {ReturnType<import('@mysten/sui/transactions').Transaction['object']>}
 */
export function fight_registry_arg(tx, network, a, scope, mutable) {
  return fight_family_arg(
    tx,
    network,
    a.FIGHT_REGISTRY_SHARDS,
    'FIGHT_REGISTRY_SHARDS',
    scope,
    mutable,
  )
}

/**
 * Place the `FightLatch` shard for one CHARACTER. Selection deliberately delegates to the same private family
 * helper and exported `fight_shard_index` as registry selection; there is exactly one index implementation.
 * @param {import('@mysten/sui/transactions').Transaction} tx
 * @param {'testnet' | 'mainnet' | 'devnet' | 'localnet'} network
 * @param {AresrpgIds} a resolved deployment ids
 * @param {string | { objectId?: string }} character character id, or a cached ref carrying it
 * @param {boolean} mutable whether THIS call mutates the latch
 */
export function fight_latch_arg(tx, network, a, character, mutable) {
  return fight_family_arg(
    tx,
    network,
    a.FIGHT_LATCH_SHARDS,
    'FIGHT_LATCH_SHARDS',
    character,
    mutable,
  )
}

function fight_family_arg(tx, network, shards, key, shard_key, mutable) {
  shards ??= []
  if (shards.length !== FIGHT_SHARD_COUNT)
    throw new Error(
      `[fight_family_arg] ${key} holds ${shards.length} rows, expected ${FIGHT_SHARD_COUNT} — the ceremony stamps one row per shard, in index order. Refusing to guess a shard.`,
    )
  const shard = shards[fight_shard_index(shard_key)]
  const ref = aresrpg_shared_ref(network, key, mutable, {
    objectId: shard.id,
    initialSharedVersion: shard.initial_shared_version,
  })
  return ref ? tx.sharedObjectRef(ref) : tx.object(shard.id)
}

/**
 * The fully-qualified `Character` type string for a resolved deployment `a` (from `aresrpg_deployment`). The
 * TYPE ORIGIN is PACKAGE_ID — struct identity is frozen at first publish and never moves to the upgrade target.
 * @param {AresrpgIds} a
 * @returns {string}
 */
export function character_type(a) {
  return `${a.PACKAGE_ID}::character::Character`
}

/**
 * The fully-qualified `Item` type string for a resolved deployment `a` (from `aresrpg_deployment`). Type origin
 * is PACKAGE_ID — see `character_type`.
 * @param {AresrpgIds} a
 * @returns {string}
 */
export function item_type(a) {
  return `${a.PACKAGE_ID}::item::Item`
}
