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

import { base_hp_for_class, max_hp_from_base, regen_hp } from './hp_math.js'

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

/**
 * A Character's max HP — the EXACT live on-chain formula (aresrpg_foundation::progression_math::max_hp_from_base,
 * ANNEX §4c): per-class `base_hp` + 5 per level GAINED + 1 per TOTAL vitality point, where total vitality =
 * allocated vitality + net gear vitality (gear_pos.vit − gear_neg.vit, clamped ≥0), folded 1:1 — i.e. the GEARED
 * pool `equipment::fold_gear` seats a character with. `base_hp` is the per-class GameConfig row (`aresrpg::config`
 * default_classes; see hp_math.DEFAULT_CLASS_BASE_HP for provenance + the /v1-override follow-up). Level is
 * derived from `experience` via the shared 1.29 XP curve (`experience_to_level`, floored ≥1 so `level−1` never
 * underflows), exactly as the chain's `level_from_xp`. DELIBERATELY NOT the client stat-sheet `get_max_health`
 * (@aresrpg/sdk/stats), a different reference-faithful formula on another scale — this pairs with current_hp's own
 * scale so a projected-HP bar never clamps/overflows and re-hides damage.
 * @param {CharacterFields} character @returns {number}
 */
export function character_max_hp(character) {
  const level = experience_to_level(Number(character.experience ?? 0))
  const base_hp = base_hp_for_class(character.classe ?? character.class)
  const total_vit = Number(character.vitality ?? 0) + Number(character.gear_vitality ?? 0)
  return max_hp_from_base(base_hp, level, total_vit)
}

/**
 * The character's current HP projected to `now_ms`, replicating the on-chain lazy natural regen
 * (aresrpg_foundation::progression_math::regen_hp, ANNEX §5.4) so an off-chain read matches what a chain settle
 * would compute: HP/sec = `(150 + level×6 + wisdom×2) / 75` accrued from the stored `current_hp`, capped at max,
 * clock-skew-guarded, with the REMAINDER-CARRY law (the sub-unit fraction stays on the clock — never re-stamp
 * without the carry). SINGLE HOME for the off-chain HP projection.
 *
 * wisdom = 0: EVERY on-chain caller that settles the stored HP block passes wisdom `0`
 * (character_link.move:296 heal_hp, :330 combat_stats_settled) — the kernel accepts a wisdom term but the live
 * block-maintenance paths never wire it, so matching them with 0 keeps the projection identical to a chain settle.
 * (Passing the character's real wisdom would out-regen the chain and re-introduce the very drift this fixes.)
 * @param {CharacterFields} character @param {number} now_ms  Unix ms (typically Date.now()) @returns {number}
 */
export function projected_hp(character, now_ms) {
  const max = character_max_hp(character)
  const level = experience_to_level(Number(character.experience ?? 0))
  const current = Number(character.current_hp ?? 0)
  const last = Number(character.hp_updated_ms ?? 0)
  const [hp] = regen_hp(current, last, max, level, 0, now_ms)
  return hp
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
