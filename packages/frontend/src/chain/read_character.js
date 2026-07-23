// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read ONE on-chain Character's fields, chain-direct (no server, no WS), and normalise them into the
// flat shape every off-chain consumer wants. SINGLE source of truth for "what a Character looks like
// off the chain": the Move `Character` struct (packages/move/sources/character/character.move) → a flat
// JS object with numeric stats. Shared by:
//   • the backend-off roster loader (load_roster.js) → the CharactersDrawer rows + detail header,
//   • the 3D avatar cosmetics (#7 — color_1/2/3 + classe + sex/male),
//   • the expedition deploy stat snapshot (#2/#3 — the combat block: experience + the 6 base stats).
//
// getObject returns Move integers as: u8 / u16 / u32 → JS number, u64+ → string. Every Character numeric
// field here is ≤ u32 so they arrive as numbers; `Number()` is a belt-and-suspenders coercion that also
// survives the RPC ever widening a field to a string. `sex` is the on-chain "male" / "female" string;
// `male` is the bool the mint/creator PTB packs (sex === "male").

import { experience_to_level } from '@aresrpg/sdk/experience'
import { get_total_stat } from '@aresrpg/sdk/stats'

import { base_hp_for_class, max_hp_from_base, next_regen_hp_ms, regen_hp } from './hp_math.js'

/**
 * @typedef {{
 *   id: string,
 *   _type: string,
 *   name: string,
 *   classe: string,
 *   sex: string,
 *   male: boolean,
 *   realm: string,
 *   position: string,
 *   experience: number,
 *   level?: number,
 *   health: number,
 *   color_1: number,
 *   color_2: number,
 *   color_3: number,
 *   vitality: number,
 *   wisdom: number,
 *   strength: number,
 *   intelligence: number,
 *   chance: number,
 *   agility: number,
 *   available_points: number,
 *   current_hp: number,
 *   hp_updated_ms: number,
 *   gear_vitality: number,
 *   spell_points: number,
 *   spell_levels: Record<number, number>,
 * }} CharacterFields
 */

/**
 * Decode a Character's `spells.levels` VecMap<u16,u8> into a plain `{ [spell_id]: level }` map. Over gRPC json
 * (the read_character path) the VecMap renders FLAT as `{ contents: [{ key: <spell_id>, value: <level> }] }`
 * with numeric key/value (verified live: a senshi reads `{1:1,2:1,3:1}`); a nested read (escrow/stake Character)
 * can wrap entries in `.fields`, so both shapes are handled — mirrors read_dungeon.js's defensive VecMap decode.
 * Absent/empty spellbook → `{}`. SINGLE HOME for the off-chain per-spell level read.
 * @param {any} spells the decoded `spells: SpellAllocation` struct (or undefined)
 * @returns {Record<number, number>}
 */
function normalize_spell_levels(spells) {
  const levels = spells?.levels?.fields ?? spells?.levels
  const contents = levels?.contents ?? []
  /** @type {Record<number, number>} */
  const out = {}
  for (const entry of contents) {
    const e = entry?.fields ?? entry ?? {}
    const key = Number(e.key?.fields ?? e.key)
    if (!Number.isFinite(key)) continue
    out[key] = Number(e.value?.fields ?? e.value ?? 0)
  }
  return out
}

/**
 * Normalise a Character's raw on-chain `fields` (the BCS-decoded struct) into the flat off-chain shape.
 * SINGLE source of truth for the mapping, shared by:
 *   • `read_character` (a standalone kiosk-locked Character object → its own `content.fields`), and
 *   • the roster loader's EXPLORING branch (a Character ESCROWED inside an Expedition — a WRAPPED struct
 *     that `getObject` cannot fetch directly, so its fields are read off the Expedition's nested
 *     `content.fields.character.fields`, with the type off `content.fields.character.type`).
 * @param {Record<string, any>} f  the Character struct's decoded `fields`
 * @param {string} id  the Character object id (kiosk item objectId, or the escrowed `character.fields.id.id`)
 * @param {string} type  the full struct type (`…::character::Character`)
 * @returns {CharacterFields}
 */
export function normalize_character(f, id, type) {
  // CURRENT struct (character.move): `class: String`, `male: bool`, colors NESTED in `customization`
  // (a plain object over gRPC json, `{ fields }`-wrapped over a nested JSON-RPC read). The legacy flat
  // `classe`/`sex`/`color_N` names stay as fallbacks for pre-split lineage reads. [P1 2026-07-09
  // "invisible player": reading ONLY the legacy flat names returned classe=''/colors=0 for every
  // current character — the '' clobbered the RPC card's class on the appearance-hydrate merge and the
  // voxel mount silently skipped the avatar. Verified against live gRPC json of 0x93e0…/0x3fa7….]
  const male = typeof f.male === 'boolean' ? f.male : String(f.sex ?? 'male') === 'male'
  const custom = f.customization?.fields ?? f.customization ?? {}
  // `_type` (the full struct type) is the marker the HUD checks to derive max-HP from stats
  // (get_max_health) instead of reading a raw `health` field — see CharactersDrawer RosterEntry /
  // Stats.jsx (`character._type ? get_max_health(...) : ...`).
  return {
    id,
    _type: String(type ?? ''),
    name: String(f.name ?? ''),
    classe: String(f.classe ?? f.class ?? ''),
    sex: male ? 'male' : 'female',
    male,
    realm: String(f.realm ?? 'overworld'),
    position: String(f.position ?? ''),
    experience: Number(f.experience ?? 0),
    health: Number(f.health ?? 0),
    color_1: Number(custom.color_1 ?? f.color_1 ?? 0),
    color_2: Number(custom.color_2 ?? f.color_2 ?? 0),
    color_3: Number(custom.color_3 ?? f.color_3 ?? 0),
    vitality: Number(f.vitality ?? 0),
    wisdom: Number(f.wisdom ?? 0),
    strength: Number(f.strength ?? 0),
    intelligence: Number(f.intelligence ?? 0),
    chance: Number(f.chance ?? 0),
    agility: Number(f.agility ?? 0),
    available_points: Number(f.available_points ?? 0),
    // T76 HP TRUTH: the REAL current HP + the lazy-regen clock anchor. Both are u64 on-chain, so gRPC json
    // returns them as strings — Number() coerces (ms timestamps fit a JS number). The legacy `health` field
    // above is a vestigial class-base value the HUD never trusts for a typed character; these two + the gear
    // vitality below are what projected_hp() reads to show honest current HP off-chain.
    current_hp: Number(f.current_hp ?? 0),
    hp_updated_ms: Number(f.hp_updated_ms ?? 0),
    // NET gear vitality — character_health.move `max_hp` folds `max(0, gear_pos.vit − gear_neg.vit)` (the twin
    // non-negative gear caches on the Character struct, Stats.vitality field). Threaded so character_max_hp()
    // reproduces the on-chain max EXACTLY, gear included (current_hp is capped at that gear-inclusive max).
    gear_vitality: Math.max(0, Number(f.gear_pos?.vitality ?? 0) - Number(f.gear_neg?.vitality ?? 0)),
    // #55 SPELL BOOK — the character's unspent spell points (+1 per level-up) and per-spell level map, off the
    // on-chain `spells: SpellAllocation { points: u64, levels: VecMap<u16,u8> }`. `points` is u64 → a string over
    // gRPC → Number() coerces (points ≤ char level, fits a JS number). The grimoire reads these for the REAL
    // per-spell level + available points and the honest LEVEL-UP gate (character_spells::character_upgrade_spell).
    spell_points: Number(f.spells?.fields?.points ?? f.spells?.points ?? 0),
    spell_levels: normalize_spell_levels(f.spells?.fields ?? f.spells),
  }
}

/** Stored progression level when `/v1` carries it, otherwise the same immutable XP-curve derivation as the chain.
 * @param {CharacterFields} character @returns {number} */
const character_level = (character) => {
  const stored_level = Number(character.level)
  return Number.isFinite(stored_level) && stored_level >= 1
    ? stored_level
    : experience_to_level(Number(character.experience ?? 0))
}

/**
 * The max HP used by the chain's lazy-regen settle. `character_link::combat_scalars` settles BEFORE
 * `equipment::fold_gear`, so this cap contains class base + level growth + allocated vitality only. The later
 * signed gear fold recomputes the displayed/fight max; positive gear cannot create regen in added capacity, while
 * a vitality malus clamps the settled HP afterward.
 * @param {CharacterFields} character @returns {number}
 */
export function character_regen_max_hp(character) {
  const level = character_level(character)
  const base_hp = base_hp_for_class(character.classe ?? character.class)
  return max_hp_from_base(base_hp, level, Number(character.vitality ?? 0))
}

/**
 * The final geared max HP used by the HUD denominator and fight snapshot after `equipment::fold_gear`: per-class
 * base + 5 per level gained + total effective vitality (allocated plus the signed equipment aggregate, floored at
 * zero). This is deliberately distinct from the pre-gear lazy-regen cap above, matching the chain's call order.
 * @param {CharacterFields} character @returns {number}
 */
export function character_max_hp(character) {
  const level = character_level(character)
  const base_hp = base_hp_for_class(character.classe ?? character.class)
  const total_vit = get_total_stat(character, 'vitality')
  return max_hp_from_base(base_hp, level, total_vit)
}

/**
 * The character's current HP projected to `now_ms`, replicating the on-chain lazy natural regen
 * (aresrpg_foundation::progression_math::regen_hp, ANNEX §5.4) so an off-chain read matches what a chain settle
 * would compute: HP/sec = `(150 + level×6 + wisdom×2) / 75` accrued from the stored `current_hp`, capped at the
 * pre-gear regen max and then clamped to `equipment::fold_gear`'s signed geared max, clock-skew-guarded, with the
 * REMAINDER-CARRY law (the sub-unit fraction stays on the clock — never re-stamp without the carry). SINGLE HOME
 * for the off-chain HP projection.
 *
 * wisdom = 0: EVERY on-chain caller that settles the stored HP block passes wisdom `0`
 * (character_link.move:365 heal_hp, :406 combat_stats_settled) — the kernel accepts a wisdom term but the live
 * block-maintenance paths never wire it, so matching them with 0 keeps the projection identical to a chain settle.
 * (Passing the character's real wisdom would out-regen the chain and re-introduce the very drift this fixes.)
 * @param {CharacterFields} character @param {number} now_ms  Unix ms (typically Date.now()) @returns {number}
 */
export function projected_hp(character, now_ms) {
  const regen_max = character_regen_max_hp(character)
  const folded_max = character_max_hp(character)
  const level = character_level(character)
  const current = Number(character.current_hp ?? 0)
  const last = Number(character.hp_updated_ms ?? 0)
  const [settled] = regen_hp(current, last, regen_max, level, 0, now_ms)
  return Math.min(settled, folded_max)
}

/**
 * Earliest absolute millisecond when `projected_hp` will gain its next integer point, or null at the chain settle
 * cap. The unchanged `/v1` anchor remains the only input; timer ticks never manufacture a replacement anchor.
 * @param {CharacterFields} character @param {number} now_ms @returns {number | null}
 */
export function next_projected_hp_ms(character, now_ms) {
  const max = Math.min(character_regen_max_hp(character), character_max_hp(character))
  const level = character_level(character)
  const current = Number(character.current_hp ?? 0)
  const last = Number(character.hp_updated_ms ?? 0)
  return next_regen_hp_ms(current, last, max, level, 0, now_ms)
}

/**
 * Read + normalise a single on-chain Character object.
 * @param {import("@mysten/sui/grpc").SuiGrpcClient} grpc_client  the SDK's gRPC Core client (#23)
 * @param {string} id  the Character object id (the kiosk-locked item's objectId)
 * @returns {Promise<CharacterFields>}
 */
export async function read_character(grpc_client, id) {
  // #23 gRPC: core.getObject({include:{json:true}}) → { object:{ type, json } }; json FLATTENS the struct
  // (nested `.fields`/UID gone) — Character is flat scalars so normalize_character reads them directly.
  const { object } = await grpc_client.core.getObject({ objectId: id, include: { json: true } })
  const f = /** @type {Record<string, any>} */ (object?.json)
  if (!f) throw new Error(`Character ${id} has no readable on-chain content`)

  return normalize_character(f, id, object.type)
}
