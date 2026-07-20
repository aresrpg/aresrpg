// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mob basic-attack spell templates — derived 1:1 from each mob's authored `melee_damage`
// ({ element, min, max }) in mobs.json. This unblocks c101 (mobs never attack): a mob FightEntity needs a
// CASTABLE attack for the AI to use, and that attack's DATA is the donor's per-mob melee damage.
//
// WHY base_effect == melee_damage (faithful): a mob FightEntity carries ZERO combat stats
// (server `mob_to_fight_entity` sets strength/intelligence/... = 0). The sim damage formula
// (spell_calculator.calculate_raw_damage) is `base_effect.min/max + floor(element_stat / 10) + raw_damage`,
// so with mob stats 0 the stat/raw bonuses are 0 and the dealt damage == the spell's base_effect range ==
// the donor mob's authored melee_damage. No double-count, no invented numbers.
//
// SHAPE: the spells.json template shape (nested under a `mobs` pseudo-class), so it folds into the sim's
// `normalize_spell_templates` verbatim — NO sim change.
//
// WIRING (combat track — fight modules are their lane):
//   1) merge into the global template map (player_fight.js):
//        normalize_spell_templates({ ...spells_json, mobs: mob_attack_spells() })
//   2) at fight assembly (fight_assemble.js / mob_to_fight_entity), where the wire Entity.variant = the mob
//      TEMPLATE id (carried since the c062 roster), give each mob FightEntity the attack:
//        const sid = mob_attack_spell_id(entity.variant)
//        deck: [sid], hand: [sid], spell_levels: { [sid]: 1 }
//   3) the existing AI (drive_ai_turns / fight_ai.js) then plans + casts it like any spell (move into range,
//      cast). The attack is range-1 melee, so the AI closes to an adjacent cell first.
//
// The cost/range/casts below are COMBAT KNOBS (not donor data) — sensible defaults the combat track may tune
// for pacing — mobs take a minimum time, moving step-by-step before they attack. The DAMAGE + ELEMENT
// are the faithful authored data and should not be invented away.

import MOBS from './mobs.json' with { type: 'json' }

// Castable defaults — mob AP is 6 (server MOB_AP), so cost 3 leaves room to move (MP) and swing once.
const ATTACK_AP_COST = 3
// Melee, adjacent. The donor's ranged attackers carry a `projectile` field that our mobs.json seed dropped,
// so EVERY mob is melee here. FLAGGED: restore `projectile` (a re-pull) to give ranged mobs a >1 range.
const ATTACK_RANGE = 1
// One swing per turn — the donor mobs attack once; this also prevents an AP-nuke (multiple casts/turn).
const ATTACK_CASTS_PER_TURN = 1
// Token element-matched hit for the few mobs whose snapshot dropped melee_damage (4 of the 80 lvl<=20
// spawnables) so they still ACT on their turn. FLAGGED: not authored damage (a re-pull would restore it).
const FALLBACK_MIN = 1
const FALLBACK_MAX = 2
// The sim's ELEMENT_MAP only knows fire/water/earth/air; map anything else (e.g. a 'neutral' fallback) to
// earth (the physical/strength element) so the effect always resolves.
const SIM_ELEMENTS = /** @type {const} */ (['fire', 'water', 'earth', 'air'])
const DEFAULT_ELEMENT = 'earth'

/**
 * The stable spell id for a mob's basic attack, keyed by the mob TEMPLATE id (== the wire Entity.variant the
 * roster sets). Collision-free with class spell ids (short ids like 'charge') via the `mob_attack_` prefix.
 * @param {string} mob_id
 * @returns {string}
 */
export const mob_attack_spell_id = mob_id => `mob_attack_${mob_id}`

/**
 * One spells.json-shaped level for a mob's basic attack, from its authored melee_damage + element.
 * @param {{ melee_damage?: { element?: string, min?: number, max?: number }, element?: string, stats?: { critical?: number } }} mob
 * @returns {Record<string, unknown>}
 */
const attack_level = mob => {
  const melee = mob.melee_damage
  const raw_element = melee?.element ?? mob.element ?? DEFAULT_ELEMENT
  const element = /** @type {readonly string[]} */ (SIM_ELEMENTS).includes(
    raw_element,
  )
    ? raw_element
    : DEFAULT_ELEMENT
  // Floor at 1: a castable attack must deal >=1 (a couple of donor mobs carry an authored 0-0 melee, e.g.
  // snapthorn_weak — a 0-damage cast is inert, so even the weakest mob scratches for 1). max >= min always.
  const min = Math.max(1, melee?.min ?? FALLBACK_MIN)
  const max = Math.max(min, melee?.max ?? FALLBACK_MAX)
  return {
    cost: ATTACK_AP_COST,
    range: [1, ATTACK_RANGE],
    critical_chance: mob.stats?.critical ?? 0,
    area: 0,
    area_type: 'circle',
    casts_per_turn: ATTACK_CASTS_PER_TURN,
    casts_per_target: 0,
    turns_to_recast: 0,
    modifiable_range: false,
    line_of_sight: true,
    linear: false,
    free_cell: false,
    base_effects: [
      { type: 'damage', min, max, target: 'cell', element, chance: 100 },
    ],
    critical_effects: [],
  }
}

/**
 * Every mob's basic-attack spell, as a spells.json-shaped block keyed by `mob_attack_<id>` — fold it under a
 * `mobs` pseudo-class into `normalize_spell_templates({ ...spells_json, mobs: mob_attack_spells() })` so the
 * sim resolves a mob's deck spell id like any other. One template per mob id (cheap; ~386). The combat track
 * points each mob FightEntity's deck/hand/spell_levels at its `mob_attack_<id>`.
 * @returns {Record<string, { name: string, description: string, levels: Record<string, unknown>[] }>}
 */
export const mob_attack_spells = () => {
  /** @type {Record<string, { name: string, description: string, levels: Record<string, unknown>[] }>} */
  const spells = {}
  for (const mob of Object.values(/** @type {Record<string, any>} */ (MOBS))) {
    if (!mob.id) continue
    spells[mob_attack_spell_id(mob.id)] = {
      name: `${mob.name ?? 'Mob'} Attack`,
      description: '',
      levels: [attack_level(mob)],
    }
  }
  return spells
}
