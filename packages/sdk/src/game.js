// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
  random_shared_ref,
} from './deployment/aresrpg.js'
import FORGE_CATALOG_DATA from './forge_catalog.json' with { type: 'json' }
import { as_object_arg } from './sui/object_arg.js'
import { ITEM_STAT_FIELDS } from './sui/read/items.js'

// &Random (0x8) PIN — mirrors fight.js's `random_arg` (see there for the full latency rationale). Pins the
// system object via `random_shared_ref` when the network's genesis version is stamped; falls back to the
// unresolved `tx.object.random()` otherwise. Byte-identical either way (mutable:false, same 0x8) — execution
// and Random-PTB terminality are unchanged; only the build-time resolve round-trip is saved.
/** @param {'mainnet'|'testnet'|'devnet'|'localnet'} network @param {import('@mysten/sui/transactions').Transaction} tx */
function random_arg(network, tx) {
  const ref = random_shared_ref(network)
  return ref ? tx.sharedObjectRef(ref) : tx.object.random()
}

// GAME — the public per-domain home for the merged `aresrpg` package's PROGRESSION flows. The world flows
// (join_world / search_zone / gather) live in `sui/write/game_world.js`, the live-`World` read in
// `sui/read/game.js`, and the S-52 craft in `sui/write/craft.js`; this module RE-EXPORTS them (one public import
// per domain, mirroring `fight.js`) and adds the player's spend doors: `raise_spell_level` (spell points → per-spell
// level), `feed` (pet item-feeding), and the FORGEMAGIE lane (forgemagie.move — supersedes the old `runes`
// doors, body-killed `abort EDeprecated`): `crush` (ONE TX — destroys the gear, rolls
// the yield AND kiosk-locks the minted rune stacks in the same call via 35 fixed template slots; the old
// receipt→mint_crushed→burn_receipt 3-step is DELETED) and `scribe_rune` (apply ONE rune, RNG CS/NS/CF
// outcome). Every door takes the player's `&Kiosk` + `&PersonalKioskCap` directly and unwraps the KioskOwnerCap
// ON-CHAIN (the `game_world.js` shape — no borrow_val dance). `crush`/`scribe_rune` are TERMINAL-`&Random`
// entries (`tx.object.random()` LAST — one action per PTB); the rest are deterministic.
//
// FROZEN Move signatures — read firsthand from packages/move/aresrpg/sources/{spell_level,pet,forgemagie}.move +
// packages/move/foundation/sources/rune_catalog.move. The S-46 merge KILLED the CharacterLink + EquipmentRegistry
// custody objects and the per-package versions — every door is single-`version::Version`-gated and reads the
// character straight off the caller's kiosk.
//
// S-51b STATIC REFS: deployment singletons (GameConfig / Version / ItemPolicy / PetFeedConfig / the shared
// `ItemExtractPolicy` — EXTRACT_POLICY joined the id map, the old `item_extract_policy_id` args are gone) are
// STATIC SharedObjectRefs via the shared-version cache (aresrpg_shared_ref); mutability mirrors the Move ref
// kind EXACTLY. The shared `CrushBoard` (`crush_board_id`) is a SEED object — it stays a runtime arg on the
// ref-or-id seam (`as_object_arg`, sui/object_arg.js: id string or caller-cached ref), like every
// kiosk/pkcap/template/receipt param.

export {
  join_world_ptb,
  search_zone_ptb,
  gather_ptb,
} from './sui/write/game_world.js'
export { get_world, get_mob_template } from './sui/read/game.js'
// The ONE home for resolving a wrapped World's payload (#1289) — every consumer that wants a world FACT the
// `get_world` snapshot does not carry (the dungeon rooms/key) reads it through this, never off the shell.
export {
  read_world_inner,
  world_inner_field_id,
  WORLD_VERSION,
} from './sui/read/world_inner.js'
export { get_zone_state, decode_zone_state, zone_key_bytes } from './sui/read/zone_spawns.js'
export { craft_ptb } from './sui/write/craft.js'
export {
  commission_request_ptb,
  commission_accept_ptb,
  commission_execute_ptb,
  commission_cancel_ptb,
  commission_redeem_xp_ptb,
} from './sui/write/commission.js'
export { get_crush_registry, rune_key } from './sui/read/crush.js'

// Forgemagie catalog codes — MIRRORS foundation `rune_catalog.move` (stat ids = the ItemStatistics field order
// 0..16; rune tiers Ba/Pa/Ra = 1/2/3). The single JS home for decoding the `RuneScribed` / `Crushed` events and
// the crush registry's (stat, tier) keys.
export const FORGE_STAT_ORDER = ITEM_STAT_FIELDS
export const FORGE_STATS = Object.freeze(
  Object.fromEntries(FORGE_STAT_ORDER.map((field, stat) => [field, stat])),
)
export const FORGE_TIERS = Object.freeze({ BA: 1, PA: 2, RA: 3 })

/**
 * The context a game builder needs: the network (drives lazy id resolution) + an optional `ids` injection seam.
 * @typedef {object} GameContext
 * @property {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @property {{ aresrpg?: Record<string, string> }} [ids]
 */

/** Guard the shared `CrushBoard` id (a ceremony object — seed record `crushBoard`, not a deployment singleton). */
function require_board(crush_board_id) {
  if (!crush_board_id)
    throw new Error(
      '[game] crush_board_id is required — the shared forgemagie CrushBoard object id (seed record).',
    )
  return crush_board_id
}

/** Guard the sibling `aresrpg_forgemagie` package id (package-split 2026-07-12). NON-required in the core
 *  deployment gate — the create/fight/pool core builds without it — so the scribe/crush builders refuse loudly
 *  rather than emit an empty `::forgemagie::*` target. Same "refuse, never guess" law as `aresrpg_deployment`'s
 *  REQUIRED gate (and `kolizeum_ids`), scoped to the one sibling id. Returns the CALL-TARGET package id. */
function require_forgemagie(a) {
  if (!a.FORGEMAGIE_PACKAGE_ID)
    throw new Error(
      `[game] aresrpg_forgemagie is not deployed on "${a.network}" — FORGEMAGIE_PACKAGE_ID is unset. Stamp it in src/deployment/aresrpg.js at the publish ceremony before any scribe/crush call.`,
    )
  return a.FORGEMAGIE_PACKAGE_ID
}

// ╔════════════════ [ SPELL LEVELS — spend points to raise one spell (S-12d) ] ═ ]

/**
 * Raise ONE owned spell by ONE level, spending the escalating spell-point cost (`spell_level::raise_spell_level`).
 * `spell_template_id` is the `&SpellTemplate` shared object (per-(class,unlock)) — the door reads the authoritative
 * max + character-level gate straight off it. Owner-gated by the personal-cap on-chain. PTB-first: ONE level per
 * call (no batch door — the SDK composes the sequence). The merge dropped the CharacterLink + the second version.
 * @param {GameContext} context
 */
export function raise_spell_level_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    spell_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::spell_level::raise_spell_level`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        as_object_arg(tx, spell_template_id), // spell: &SpellTemplate
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ STAT ALLOCATION — spend points to raise one stat (§3) ] ══ ]

/**
 * Raise ONE character stat by `points` allocated stat points (`stat_allocation::raise_stat`) — the twin of
 * `raise_spell_level` for the STAT half of the per-level grant (SPEC §3: "5 stat points to assign freely"). Cost is
 * FLAT: +N to a stat costs exactly N points (no escalation curve). `stat` is the 0-based stat index (0..5 —
 * vitality/wisdom/strength/intelligence/chance/agility, `character_link::stat_count()`); the Move door aborts EBadStat
 * out of range, EZeroPoints on 0, ENoStatPoints when unspent < points. Owner-gated by the personal-cap on-chain (the
 * `kiosk::borrow_mut` cap check, identical to raise_spell_level). PTB-first: ONE stat per call — the SDK composes the
 * sequence to spread points across stats. Version-gated (a value path); no CharacterLink / second version.
 * @param {GameContext} context
 */
export function raise_stat_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    stat,
    points,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::character_link::raise_stat`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.u8(stat), // stat: u8 (0-based stat index, 0..stat_count()-1)
        tx.pure.u64(BigInt(points)), // points: u64 (stat points to allocate — flat 1:1 cost)
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version (THE one)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ PET FEED — one UTC-day feed, template-derived item stats ] ═ ]

/**
 * Burn one unit of `food_item_id` and advance a loose or equipped pet by one of 60 daily feeds. Move reads the
 * authenticated `pet_template_id`, derives the item's current stats from its template maximum, and gates the write
 * with the Sui Clock. The shared feed/extract/config/version objects resolve from the stamped deployment.
 * @param {GameContext} context
 */
export function feed_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    pet_item_id,
    pet_template_id,
    food_item_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id) throw new Error('kiosk_id is required')
    if (!personal_kiosk_cap_id) throw new Error('personal_kiosk_cap_id is required')
    if (!character_id) throw new Error('character_id is required')
    if (!pet_item_id) throw new Error('pet_item_id is required')
    if (!pet_template_id) throw new Error('pet_template_id is required')
    if (!food_item_id) throw new Error('food_item_id is required')

    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::pet::feed_pet`,
      arguments: [
        shared_object_arg(
          tx,
          network,
          'PET_FEED_CONFIG',
          false,
          a.PET_FEED_CONFIG,
        ), // feed_config: &PetFeedConfig
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.id(pet_item_id), // pet_item_id: ID
        as_object_arg(tx, pet_template_id), // pet_template: &ItemTemplate
        tx.pure.id(food_item_id), // food_item_id: ID
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        tx.object.clock(), // clock: &Clock (UTC-day gate)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ FORGEMAGIE — chain-derived catalog + crush math ] ═════════ ]

/**
 * Foundation `rune_catalog.move` tables are generated into the SDK corpus by
 * `scripts/generate_forge_catalog.mjs`; this runtime only freezes that chain-derived data beside the
 * `forgemagie.move` band/taux constants used by the preview.
 */
const frozen_catalog_tables = catalog =>
  Object.freeze(
    {
      unit_weights: Object.freeze([...catalog.unit_weights]),
      runeable: Object.freeze([...catalog.runeable]),
      ba_amount: Object.freeze([...catalog.ba_amount]),
      pa_amount: Object.freeze([...catalog.pa_amount]),
      ra_amount: Object.freeze([...catalog.ra_amount]),
    },
  )

export const FORGE_CATALOG = Object.freeze({
  ...frozen_catalog_tables(FORGE_CATALOG_DATA),
  band_max_level: Object.freeze([20, 50, 100, 150]),
  band_divisor: Object.freeze([277, 2044, 6675, 12922, 19822]),
  coeff_scale: 1_000,
  neutral_milli: 100_000,
  floor_milli: 1_000,
  cap_milli: 4_000_000,
  recipeless_cap_milli: 50_000,
  shift: 32_768, // ItemStatistics centering: raw magnitude = max(0, centered − shift)
})

/** The per-level-band crush divisor (mirrors foundation forgemagie's `band_divisor` — a Move-internal fn,
 * never a PTB target; named without the module path so the keep-set gate doesn't read it as one). */
export function band_divisor(item_level) {
  const { band_max_level, band_divisor: divisors } = FORGE_CATALOG
  for (let i = 0; i < band_max_level.length; i++)
    if (item_level <= band_max_level[i]) return divisors[i]
  return divisors[band_max_level.length]
}

/** Centered 17-field stats (`{ vitality: 32808, … }`) → raw magnitudes array (id order; malus lines = 0). */
export function raw_magnitudes(centered_stats) {
  return FORGE_STAT_ORDER.map(field => {
    const v = Number(centered_stats?.[field] ?? FORGE_CATALOG.shift)
    return v > FORGE_CATALOG.shift ? v - FORGE_CATALOG.shift : 0
  })
}

/**
 * The DETERMINISTIC reachable rune set of one item: for every positive runeable line, the Ba rune always, and
 * Pa/Ra when `value ≥ amount × 3` (the sealed reference-corpus `selectRuneTier` eligibility floor — the roll only decides
 * WHICH eligible tier fires per yielded rune, never reaches an ineligible one). The crush action refuses
 * pre-flight when any reachable key is missing from the on-chain registry (a rune the chain could owe but
 * could never mint — the chain DROPS such a row silently since #1840, so this pre-flight is the only guard).
 * @param {Record<string, number>} centered_stats the item's ROLLED block (centered u16 fields)
 * @returns {{ stat: number, tier: number }[]}
 */
export function reachable_rune_keys(centered_stats) {
  const raw = raw_magnitudes(centered_stats)
  const keys = []
  raw.forEach((value, stat) => {
    if (value === 0 || !FORGE_CATALOG.runeable[stat]) return
    keys.push({ stat, tier: FORGE_TIERS.BA })
    const pa = FORGE_CATALOG.pa_amount[stat]
    const ra = FORGE_CATALOG.ra_amount[stat]
    if (pa > 0 && value >= pa * 3) keys.push({ stat, tier: FORGE_TIERS.PA })
    if (ra > 0 && value >= ra * 3) keys.push({ stat, tier: FORGE_TIERS.RA })
  })
  return keys
}

/**
 * The client-side crush YIELD PREVIEW — a faithful integer mirror of foundation `crush_lines`' per-line EV:
 * `num = level × value × unit_weight × coeff`, `den = 100 × coeff_scale × rune_weight_ba × band_divisor(level)`,
 * stochastically rounded on-chain ⇒ the honest per-stat band is `[floor(num/den), floor+1)` when a fractional
 * part exists. Tiers roll per yielded rune AT CRUSH (never previewable) — the preview aggregates per STAT.
 * @param {{ centered_stats: Record<string, number>, item_level: number, coeff_milli?: number, recipe_less?: boolean }} args
 * @returns {{ stat: number, stat_key: string, min: number, max: number }[]} one row per positive runeable line
 */
export function crush_yield_preview({
  centered_stats,
  item_level,
  coeff_milli,
  recipe_less = false,
}) {
  const cat = FORGE_CATALOG
  let coeff = Math.min(
    Math.max(Number(coeff_milli ?? cat.neutral_milli), cat.floor_milli),
    cat.cap_milli,
  )
  if (recipe_less && coeff > cat.recipeless_cap_milli)
    coeff = cat.recipeless_cap_milli
  const divisor = band_divisor(item_level)
  const raw = raw_magnitudes(centered_stats)
  const rows = []
  raw.forEach((value, stat) => {
    if (value === 0 || !cat.runeable[stat]) return
    const unit = cat.unit_weights[stat]
    const rune_weight_ba = cat.ba_amount[stat] * unit
    const num = item_level * value * unit * coeff
    const den = 100 * cat.coeff_scale * rune_weight_ba * divisor
    const min = Math.floor(num / den)
    rows.push({
      stat,
      stat_key: FORGE_STAT_ORDER[stat],
      min,
      max: num % den ? min + 1 : min,
    })
  })
  return rows
}

// ╔════════════════ [ FORGEMAGIE — CRUSH (ONE TX: destroy gear → roll → mint runes) ] ═ ]

/** The Move door's fixed rune-template arity — the FROZEN catalog bound on distinct rune templates one crush
 * can yield (10 multi-tier stats × 3 tiers + 5 single-tier majors; `rune_catalog` law "runes never change"). */
export const CRUSH_TEMPLATE_SLOTS = 35

/**
 * TESTNET-MEASURED per-item `forgemagie::crush` gas in MIST — the PRE-rebate peak (comp+storage) of a real crush.
 * `null` would REFUSE LOUDLY (crush consumes `&Random`: the yield/tier rolls drive a value-dependent mint loop, so
 * its cost is NOT simulation-stable — a guessed low budget fails ON-CHAIN and burns the full budget; TX-RETRY LAW:
 * an executed failure is never auto-retried).
 *
 * MEASURED 2026-07-11 (lineage-6 core 0xa837cc99…, digest 9jrVSfNWw1fJkzHrTTiiXc4wJ3dAYE12QRxA1RNL4a7X — one real
 * crush of an L20 gear yielding 5 distinct rune stacks): comp 1,940,000 + storage 44,429,600 (rebate 13,317,480
 * lands AFTER; the budget must cover the PRE-rebate peak) ⇒ peak 46,369,600. ×1.5 ≈ 69.5M budget, under the 0.1 SUI
 * ceiling. Un-simulatable — this is a REAL execution, not a dryRun (the dryRun sampled 5 stacks and matched; a
 * separate 7-line gear dryRan 7 stacks but really yielded 8 → real yield runs ~1 stack HEAVIER than the sample).
 *
 * COST MODEL (least-squares fit to real runs — 5/8/14/17-stack samples): peak ≈ 12.5M + 6.8M × rune_stacks. So this
 * constant's ×1.5 budget covers ≤8 stacks (typical/most gear; the 2-line seed gear ≈ 2 stacks ≈ 27M). Gear that
 * yields MORE stacks — many stat lines, or high-value lines spreading across Ba/Pa/Ra tiers — needs a caller
 * `gas_budget_mist` override: a flat per-item constant can't cover the heavy tail under the 0.1 SUI ceiling (which
 * itself caps ANY per-item budget at ~12 stacks; a rich all-lines crush measured 108–128M > ceiling). FOLLOW-UP:
 * scale the crush budget by the previewed reachable-rune count (`reachable_rune_keys`) instead of a flat per-item
 * constant. Re-measure on any forgemagie / Item-struct size change.
 * @type {number | null}
 */
export const MEASURED_CRUSH_GAS_MIST = 46_369_600

/**
 * Derive the gas budget (MIST) for a crush of `items` gear: `ceil(MEASURED_CRUSH_GAS_MIST × 1.5) × items`.
 * REFUSES LOUDLY while the measured constant is unset — never a guess (see the constant's doc).
 * @param {{ items?: number }} [args]
 * @returns {number}
 */
export function crush_gas_budget_mist({ items = 1 } = {}) {
  if (!Number.isInteger(items) || items < 1)
    throw new Error(`[crush] items must be an integer ≥ 1 (got ${items}).`)
  if (MEASURED_CRUSH_GAS_MIST == null)
    throw new Error(
      '[crush] MEASURED_CRUSH_GAS_MIST is unset — a &Random crush budget cannot be derived from simulation ' +
        '(the rolled yield drives a value-dependent mint loop). Measure a real forgemagie::crush at the publish ' +
        'rehearsal and stamp the constant. Refusing to guess (a low guess fails on-chain and burns the full budget).',
    )
  return Math.ceil(MEASURED_CRUSH_GAS_MIST * 1.5) * items
}

/**
 * CRUSH `gear_item_ids` — ALL of ONE `gear_template` per tx (multi-template = separate txs, the Move door's
 * declared shape) — DESTROYING every item unconditionally, rolling rune yields at the board's settled taux
 * coefficient, and MINTING the yielded rune stacks into the SAME personal kiosk, all in ONE terminal-`&Random`
 * call (`forgemagie::crush`). The kiosk must hold BOTH the character AND the gear (the door borrows the
 * character off the same kiosk — the caller resolves via kiosk_for_character and refuses a mismatch).
 *
 * TEMPLATE SLOTS (distinct-padding law): `rune_template_ids` = EVERY registered rune template id off the
 * on-chain registry (`get_crush_registry().by_key` values — passing all of them guarantees every possible
 * owed rune has its mint slot); `filler_template_ids` = distinct OTHER ItemTemplate ids (any gear templates)
 * to fill the remaining slots — the door no-ops unregistered slots. The composer NEVER repeats an object id
 * across slots (duplicate object args in one MoveCall are of unverified PTB legality); `gear_template_id`
 * itself is used as the first filler. Throws when distinct templates can't fill all ${CRUSH_TEMPLATE_SLOTS}
 * slots — pass more fillers (the template catalog is huge; any distinct templates do).
 *
 * GAS: un-simulatable-value `&Random` ⇒ budget pinned from the MEASURED constant (loud-refuse until stamped)
 * unless `gas_budget_mist` overrides; execute through the keep-budget door (`submit_terminal_random_tx`).
 * @param {GameContext} context
 */
export function crush_ptb(context) {
  const { network } = context
  return ({
    crush_board_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    gear_template_id,
    gear_item_ids = [],
    rune_template_ids = [],
    filler_template_ids = [],
    gas_budget_mist,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!Array.isArray(gear_item_ids) || gear_item_ids.length === 0)
      throw new Error(
        "[crush_ptb] gear_item_ids must be a non-empty array of the account's kiosk-locked gear item ids (one template per tx).",
      )

    // Distinct slot fill: registered runes first (every owed rune needs its slot), then the gear template,
    // then caller fillers — deduped, never a repeated id (distinct-padding law).
    const slots = []
    const seen = new Set()
    for (const id of [
      ...rune_template_ids,
      gear_template_id,
      ...filler_template_ids,
    ]) {
      const key = String(id)
      if (!id || seen.has(key)) continue
      seen.add(key)
      slots.push(id)
      if (slots.length === CRUSH_TEMPLATE_SLOTS) break
    }
    if (new Set(rune_template_ids.map(String)).size > CRUSH_TEMPLATE_SLOTS)
      throw new Error(
        `[crush_ptb] ${rune_template_ids.length} rune templates exceed the ${CRUSH_TEMPLATE_SLOTS} slots — the registry is corrupt (the frozen catalog holds at most ${CRUSH_TEMPLATE_SLOTS} runes).`,
      )
    if (slots.length < CRUSH_TEMPLATE_SLOTS)
      throw new Error(
        `[crush_ptb] only ${slots.length}/${CRUSH_TEMPLATE_SLOTS} DISTINCT template slots — pass more filler_template_ids (any distinct ItemTemplate ids; the door no-ops unregistered slots).`,
      )

    tx.setGasBudget(
      gas_budget_mist ?? crush_gas_budget_mist({ items: gear_item_ids.length }),
    )
    tx.moveCall({
      target: `${require_forgemagie(a)}::forgemagie::crush`,
      arguments: [
        as_object_arg(tx, require_board(crush_board_id)), // board: &mut CrushBoard (seed object — a cached ref must be mutable:true HERE)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (holds the character AND the gear; minted runes lock here)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        as_object_arg(tx, gear_template_id), // gear_template: &ItemTemplate (ONE template per tx)
        tx.pure.vector('id', gear_item_ids), // gear_ids: vector<ID>
        ...slots.map(slot => as_object_arg(tx, slot)), // t1..t35: &ItemTemplate — the fixed distinct slots
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // policy: &TransferPolicy<Item> (minted rune stacks kiosk-lock through it)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        random_arg(network, tx), // r: &Random (0x8) — LAST → Random-PTB compliant (pinned when stamped → build-offline)
      ],
    })
    return tx
  }
}

// ╔════════════════ [ FORGEMAGIE — SCRIBE (apply ONE rune, CS/NS/CF roll) ] ════ ]

/**
 * SCRIBE ONE rune onto the kiosk-locked gear `gear_item_id` (`forgemagie::scribe_rune`, entry, terminal `&Random`):
 * consumes EXACTLY 1 unit off the rune stack `rune_item_id` (pre-roll, identical every outcome), then the
 * foundation `apply_rune` decides critical-success / normal / critical-failure off the fresh seed. ONE rune per tx —
 * the SDK composes sequences. Gates: freeze bit + version + dirty-counter + the SPEC §6 job-70
 * unlock (best job level ≥ 70). `gear_template_id`/`rune_template_id` are the two `&ItemTemplate` shared objects.
 * @param {GameContext} context
 */
export function scribe_rune_ptb(context) {
  const { network } = context
  return ({
    crush_board_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    gear_item_id,
    gear_template_id,
    rune_item_id,
    rune_template_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)

    tx.moveCall({
      target: `${require_forgemagie(a)}::forgemagie::scribe_rune`,
      arguments: [
        as_object_arg(tx, require_board(crush_board_id)), // board: &CrushBoard (rune registry — READ-ONLY here, a ref may be mutable:false)
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap
        tx.pure.id(character_id), // character_id: ID
        tx.pure.id(gear_item_id), // gear_id: ID (the kiosk-locked gear to scribe)
        as_object_arg(tx, gear_template_id), // gear_template: &ItemTemplate
        tx.pure.id(rune_item_id), // rune_item_id: ID (the rune stack — 1 unit consumed)
        as_object_arg(tx, rune_template_id), // rune_template: &ItemTemplate (the registry key)
        shared_object_arg(
          tx,
          network,
          'EXTRACT_POLICY',
          false,
          a.EXTRACT_POLICY,
        ), // xpolicy: &ItemExtractPolicy
        shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // market_policy: &TransferPolicy<Item>
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
        random_arg(network, tx), // r: &Random (0x8) — LAST → Random-PTB compliant (pinned when stamped → build-offline)
      ],
    })
    return tx
  }
}

// (mint_crushed_ptb / burn_receipt_ptb died with the receipt — the 2026-07-11 single-tx crush mints inside
// `crush_ptb`. Fresh-publish-clean: no compat shims.)
