// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight state shape + turn-order/lookup helpers.
//
// Ported from koshi-2d/.../shared/src/fight/types.ts (FightState / FightEntity / generate_turn_order /
// find_entity / get_current_turn_entity). The donor's TS interfaces become JSDoc typedefs; the SHAPE is
// faithful with TWO determinism additions the donor lacked:
//   - `turn_rng` — the explicit crank/board combat thread; player casts use a temporary public turn clock.
//   - `next_id` — a monotonic int counter; replaces every donor globalThis.crypto.randomUUID().
// Both live in state and are returned in every `{state}` so callers never see hidden mutation.
//
// The donor's `map_id` / `indicator_cell` (roam-scene coupling) are dropped; the arena is rebuilt from
// `arena_seed` + `arena_radius` via carve_world_arena (arena.js), NOT stored as cells. Cosmetic donor fields
// (hue/female/is_away) are dropped — not sim rules.

/**
 * A locked combat stat snapshot. Mirrors the donor `Stats` (types.d.ts). Built by the CALLER (server)
 * from the on-chain character + equipment via @aresrpg/sdk `stats.js` (`get_total_stat`/`get_max_health`),
 * then frozen onto the entity at fight start. The sim only READS these — plain integers in, never floats.
 * @typedef {object} Stats
 * @property {number} [vitality]
 * @property {number} [wisdom]
 * @property {number} [strength]
 * @property {number} [intelligence]
 * @property {number} [chance]
 * @property {number} [agility]
 * @property {number} [summons]   max simultaneous summons (base 1 + equipment); read by the per-caster summon cap
 * @property {number} [critical_hit]
 * @property {number} [range]
 * @property {number} [percent_damage]
 * @property {number} [raw_damage]
 * @property {number} [physical_damage]
 * @property {number} [ap_dodge]
 * @property {number} [mp_dodge]
 * @property {number} [heal]
 * @property {number} [ap_bonus]
 * @property {number} [mp_bonus]
 * @property {number} [water_resistance]
 * @property {number} [fire_resistance]
 * @property {number} [earth_resistance]
 * @property {number} [air_resistance]
 * @property {number} [neutral_resistance]
 */

/**
 * Element discriminant. Uppercase is the sim's internal canon (donor calculator.ts:16). The AresRPG
 * spells.json uses lowercase elements — `spell_templates.js` normalizes them on load.
 * @typedef {'FIRE' | 'WATER' | 'EARTH' | 'AIR' | 'NONE'} Element
 */

/**
 * When an active effect fires (donor EffectTiming, types.d.ts:76).
 * @typedef {'DIRECT' | 'TURN_START' | 'TURN_END' | 'PER_AP' | 'PER_MP'} EffectTiming
 */

/**
 * Active status effect on an entity (donor types.ts:32-41). DoT/HoT/shield/stun/invisibility.
 * @typedef {object} ActiveEffect
 * @property {number} id            sim-local id (next_id), NOT a uuid
 * @property {'DAMAGE'|'HEAL'|'SHIELD'|'POOL_SHIELD'|'STUN'|'POISON'|'INVISIBILITY'|'APPLY_STATE'|'REFLECT_DAMAGE'|'RETURN_SPELL'|'STAT_BUFF'|'STAT_DEBUFF'|'CRITICAL_FAILURE'|'DAMAGE_TO_HEAL'|'TIMED_PAYLOAD'|'NAMED_DAMAGE_STACK'|'STANCE'|'REACTIVE_PUNISHMENT'|'EROSION'|'DAMAGE_REDIRECT'} type
 * @property {EffectTiming} timing
 * @property {string} source_id     entity that applied this effect
 * @property {Element} [element]
 * @property {number} value         damage/heal amount or stat modifier — a DoT row's AUTHORED MINIMUM (#1826)
 * @property {number} [value_max]   the authored band's top: a DoT row is stored as `[value, value_max]` exactly
 *   like the chain's Effect (`spell_board::apply_dot`), and every tick rolls it (`process_turn_effects`).
 *   Absent (or ≤ `value`) is the fixed case. NEVER collapsed to a draw at apply time.
 * @property {boolean} [dot]        this DAMAGE row is a K_APPLY_DOT status, not tick bookkeeping — the badge
 *   discriminant (statuses.status_kind_of) AND the chain's tick-batch membership (`spell_board::tick_start`)
 * @property {keyof Stats | 'ap' | 'mp' | 'summons' | 'max_hp'} [stat]   buff/debuff target; max_hp is punishment vitality bookkeeping
 * @property {number} [chance]      damage-to-heal branch chance
 * @property {number} [heal_multiplier]
 * @property {number} [trigger_turns]
 * @property {string} [spell_id]    per-fight named-stack key / delayed origin
 * @property {import('./spell_templates.js').SpellEffect[]} [payload]
 * @property {number} turns_remaining
 */

/**
 * Trap placement (donor types.ts:93-101). FLAGGED-TODO: traps are not applied in the MVP core loop.
 * `anchor` = the cast TARGET cell the trap is anchored on — the 1.29 no-stack ban keys on it (validate_cast
 * refuses a trap cast targeting a live trap's anchor; optional so hand-built legacy states stay valid).
 * @typedef {object} Trap
 * @property {number} id
 * @property {string} source_id
 * @property {import('./cell.js').Cell[]} cells
 * @property {import('./spell_templates.js').SpellEffect[]} [payload]
 * @property {Element} [element] legacy damage-only trap compatibility
 * @property {number} [min]
 * @property {number} [max]
 * @property {import('./cell.js').Cell} [anchor]
 */

/**
 * Glyph placement (donor types.ts:103-111). Two shapes: a PAYLOAD glyph carries sibling effects applied to the
 * standing fighter each tick (chain payload model); a LEGACY glyph carries element/min/max damage.
 * @typedef {object} Glyph
 * @property {number} id
 * @property {string} source_id
 * @property {import('./cell.js').Cell[]} cells
 * @property {import('./spell_templates.js').SpellEffect[]} [payload]
 * @property {Element} [element] legacy damage-only glyph compatibility
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} turns_remaining
 */

/**
 * A combatant (donor FightEntity, types.ts:47-87 — minus cosmetic/disconnect fields).
 * @typedef {object} FightEntity
 * @property {string} id
 * @property {string} name
 * @property {import('./cell.js').Cell} cell
 * @property {number} health
 * @property {number} health_max
 * @property {number} ap
 * @property {number} ap_max
 * @property {number} mp
 * @property {number} mp_max
 * @property {number} ap_used        AP spent this turn (drives PER_AP effects)
 * @property {number} mp_used        MP spent this turn (drives PER_MP effects)
 * @property {boolean} is_player
 * @property {boolean} [is_summon]   true for an AI minion spawned mid-fight by a SUMMON effect (fight_summon.js)
 * @property {string} [owner_id]    for a summon: the caster id that owns it (drives the per-caster summon cap)
 * @property {string} template_id
 * @property {string} [variant]      mob art key (the model/sprite id); passthrough data, no engine logic
 * @property {number} level
 * @property {Stats} stats           locked snapshot (frozen at fight start by the caller)
 * @property {ActiveEffect[]} effects
 * @property {Record<string, number>} spell_levels  the SPELL BOOK — spell_id -> level (1-based). Its keys are
 *   the fighter's whole castable set: on chain there is no hand and no draw, so every known spell is castable
 *   every turn its authored AP / range / LoS / cast limits allow (#1012).
 * @property {number} ap_reserve     manual AP pool added to the current turn
 */

/**
 * The full fight state — the value `reduce` threads. Immutable: every transition returns a fresh object.
 * @typedef {object} FightState
 * @property {string} fight_id
 * @property {number} arena_seed     seeds carve_world_arena and the initial entropy fields (the determinism root)
 * @property {number} arena_radius
 * @property {boolean} started       false = placement phase, true = combat
 * @property {string[]} ready        entity ids that pressed READY during placement (force-start when every player is ready)
 * @property {import('./prng.js').Rng} rng   legacy capsule field; combat resolution never reads it
 * @property {import('./prng.js').Rng} turn_rng   explicit mob/board combat thread; player casts preserve it
 * @property {number} next_id        monotonic id counter (NEW vs donor, replaces crypto.randomUUID)
 * @property {FightEntity[]} team0   side A of the §17.28 interleave — players in join/seat order
 * @property {FightEntity[]} team1   side B of the §17.28 interleave — mobs in spawn order (or PvP opposing team)
 * @property {string[]} turn_order   fixed entity-id order computed at fight start
 * @property {number} current_turn_idx
 * @property {number} turn_number
 * @property {Trap[]} traps
 * @property {Glyph[]} glyphs
 * @property {import('./cell.js').Cell[]} team0_cells    placement spawn cells (= arena.spawns_a)
 * @property {import('./cell.js').Cell[]} team1_cells    placement spawn cells (= arena.spawns_b)
 * @property {-1 | 0 | 1 | 2} winner  -1 ongoing, 0 team0 wins, 1 team1 wins, 2 DRAW (stalemate, no winner)
 * @property {number} no_progress_rounds  consecutive completed rounds with zero net total-HP change (stalemate counter)
 * @property {number} last_total_hp  total HP across all fighters at the last round boundary (the no-progress baseline)
 * @property {Record<string, { last_turn: number, casts_this_turn: number }>} cast_history   per `${entity_id}:${spell_id}` cast record — the client mirror of Move's CastKey/CastRecord dynamic fields (cast.move:54-56). The cooldown / casts_per_turn clock is `turn_number` (== Move's per-seat SeatTurnKey; §1 parity invariant).
 * @property {Record<string, { last_turn: number, casts: number }>} target_history   per `${entity_id}:${spell_id}:${x},${y}` record — mirror of Move's TargetKey/TargetRecord (casts_per_target).
 */

/**
 * Find an entity by id across both teams. Donor types.ts:193.
 * @param {FightState} state
 * @param {string} entity_id
 * @returns {FightEntity | null}
 */
export const find_entity = (state, entity_id) =>
  state.team0.find(e => e.id === entity_id) ??
  state.team1.find(e => e.id === entity_id) ??
  null

/**
 * Find a LIVING entity standing on a cell. Donor types.ts:200.
 * @param {FightState} state
 * @param {import('./cell.js').Cell} cell
 * @returns {FightEntity | null}
 */
export const find_entity_at = (state, cell) =>
  state.team0.find(
    e => e.cell.x === cell.x && e.cell.y === cell.y && e.health > 0,
  ) ??
  state.team1.find(
    e => e.cell.x === cell.x && e.cell.y === cell.y && e.health > 0,
  ) ??
  null

/**
 * The entity whose turn it currently is (skips by index, not by liveness — the reducer skips the dead).
 * A CONCLUDED fight (winner !== -1, i.e. a win OR a stalemate DRAW) has no current turn -> null, so callers
 * that drive turns stop the instant the fight ends (mirrors `acting_entity`'s winner gate). Donor types.ts:182.
 * @param {FightState} state
 * @returns {FightEntity | null}
 */
export const get_current_turn_entity = state => {
  if (state.winner !== -1) return null
  const { turn_order } = state
  if (turn_order.length === 0) return null
  const id = turn_order[state.current_turn_idx % turn_order.length]
  if (id === undefined) return null
  return find_entity(state, id)
}

/**
 * The §17.28 GLOBAL turn order — NO initiative stat (SPEC §17.28; 1.29-style). Mirrors the on-chain
 * `aresrpg_fight::interleave::order` (packages/move/engine/sources/interleave.move) EXACTLY so client
 * prediction matches on-chain resolution byte-for-byte: `team0` is side A (players, in join/seat order),
 * `team1` is side B (mobs in spawn order, or the PvP opposing team). Both sides keep their GIVEN array order
 * (join/placement order breaks ties WITHIN a side) — stats never reorder anyone. The two sides weave into ONE
 * sequence that alternates as evenly as unequal sizes allow: at each slot emit from A iff A is no further along
 * its share at the slot midpoint — `(2*ia + 1) * b <= (2*ib + 1) * a` — else from B; equality → A (the
 * initiator's side opens, the fixed deterministic tie-break). Once one side drains, the other flushes in order.
 * Even teams → strict A,B,A,B…; a minority side is centered and never acts twice in a row. Called once at fight
 * start; dead entities are skipped at advance-time, never reordered. Pure + integer + deterministic.
 * @param {FightEntity[]} team0   side A — players in join/seat order
 * @param {FightEntity[]} team1   side B — mobs in spawn order (or the PvP opposing team)
 * @returns {string[]}
 */
export const generate_turn_order = (team0, team1) => {
  const side_a = team0.map(e => e.id)
  const side_b = team1.map(e => e.id)
  const a = side_a.length
  const b = side_b.length
  const order = []
  let ia = 0
  let ib = 0
  while (ia < a || ib < b) {
    // emit from A iff A is no further along its share at the slot midpoint (integer cross-multiply); once a
    // side is exhausted, drain the other. Equality → A. Identical to interleave.move `order`.
    const take_a =
      ia >= a ? false : ib >= b ? true : (2 * ia + 1) * b <= (2 * ib + 1) * a
    if (take_a) {
      order.push(side_a[ia])
      ia += 1
    } else {
      order.push(side_b[ib])
      ib += 1
    }
  }
  return order
}

/**
 * Which team (0 or 1) an entity belongs to, or -1 if not found.
 * @param {FightState} state
 * @param {string} entity_id
 * @returns {-1 | 0 | 1}
 */
export const team_of = (state, entity_id) => {
  if (state.team0.some(e => e.id === entity_id)) return 0
  if (state.team1.some(e => e.id === entity_id)) return 1
  return -1
}

/**
 * Living enemies of the given entity (the opposite team, health > 0).
 * @param {FightState} state
 * @param {string} entity_id
 * @returns {FightEntity[]}
 */
export const living_enemies = (state, entity_id) => {
  const team = team_of(state, entity_id)
  const enemies = team === 0 ? state.team1 : state.team0
  return enemies.filter(e => e.health > 0)
}

/**
 * Immutably replace one entity (matched by id) via an updater, across both teams. Donor actions.ts:16.
 * @param {FightState} state
 * @param {string} entity_id
 * @param {(entity: FightEntity) => FightEntity} updater
 * @returns {FightState}
 */
export const update_entity = (state, entity_id, updater) => ({
  ...state,
  team0: state.team0.map(e => (e.id === entity_id ? updater(e) : e)),
  team1: state.team1.map(e => (e.id === entity_id ? updater(e) : e)),
})

/**
 * Draw a fresh sim-local id and the advanced state. Replaces the donor's crypto.randomUUID() everywhere.
 * @param {FightState} state
 * @returns {{ state: FightState, id: number }}
 */
export const next_id = state => ({
  state: { ...state, next_id: state.next_id + 1 },
  id: state.next_id,
})

// ── Effective stats (base snapshot + active buff/debuff modifiers) ───────────────

/**
 * Net of the active STAT_BUFF (+) / STAT_DEBUFF (-) modifiers on `key`. The modifier's DURATION + expiry
 * are owned by the existing per-turn plumbing (`expire_turn_effects` decrements turns_remaining + drops the
 * expired); this only READS the live modifiers. Pure, integer.
 * @param {FightEntity} entity
 * @param {keyof Stats | 'ap' | 'mp' | 'summons' | 'max_hp'} key
 * @returns {number}
 */
export const stat_modifier = (entity, key) =>
  entity.effects.reduce((sum, eff) => {
    if (eff.stat !== key) return sum
    if (eff.type === 'STAT_BUFF') return sum + eff.value
    if (eff.type === 'STAT_DEBUFF') return sum - eff.value
    return sum
  }, 0)

/**
 * EFFECTIVE combat stats = the frozen base snapshot + every active stat modifier (buffs +, debuffs -). The
 * base stays IMMUTABLE (the snapshot contract: "the sim only READS these"); modifiers live as effects and are
 * folded here on read, so a buff is actually FELT by every roll/decision (damage / heal / crit / range /
 * tackle / hazard) that reads stats. ap/mp pools + 'summons' are NOT Stats keys (see effective_ap_max etc.).
 * Returns the base object UNCHANGED when there is no stat modifier (a no-op for un-buffed fighters -> existing
 * fights stay byte-identical).
 * @param {FightEntity} entity
 * @returns {Stats}
 */
export const effective_stats = entity => {
  const mods = entity.effects.filter(
    eff =>
      (eff.type === 'STAT_BUFF' || eff.type === 'STAT_DEBUFF') &&
      eff.stat !== undefined &&
      eff.stat !== 'ap' &&
      eff.stat !== 'mp' &&
      eff.stat !== 'summons' &&
      eff.stat !== 'max_hp',
  )
  if (mods.length === 0) return entity.stats
  return mods.reduce(
    (stats, eff) => {
      const key = /** @type {keyof Stats} */ (eff.stat)
      const delta = eff.type === 'STAT_BUFF' ? eff.value : -eff.value
      return { ...stats, [key]: (stats[key] ?? 0) + delta }
    },
    /** @type {Stats} */ ({ ...entity.stats }),
  )
}

/**
 * Sum of the ap/mp pool modifiers active for the upcoming turn. Timed rows age at their owner's preceding turn
 * end, exactly like Move, so every row still present at begin-turn contributes to the refill.
 * @param {FightEntity} entity
 * @param {'ap'|'mp'} key
 * @returns {number}
 */
const active_pool_modifier = (entity, key) =>
  entity.effects.reduce((sum, eff) => {
    if (eff.stat !== key) return sum
    if (eff.type === 'STAT_BUFF') return sum + eff.value
    if (eff.type === 'STAT_DEBUFF') return sum - eff.value
    return sum
  }, 0)

/**
 * Effective AP pool max = base ap_max + the ap modifiers active for the upcoming turn (clamped >= 0).
 * advance_turn refills to THIS, so an ap buff/debuff persists across the target's turns and its expiry restores
 * the base max on the FIRST turn it is no longer active (twin-parity with Move's credit aging — #598).
 * @param {FightEntity} entity
 * @returns {number}
 */
export const effective_ap_max = entity =>
  Math.max(0, entity.ap_max + active_pool_modifier(entity, 'ap'))

/**
 * Effective MP pool max = base mp_max + the mp modifiers active for the upcoming turn (clamped >= 0). See
 * effective_ap_max.
 * @param {FightEntity} entity
 * @returns {number}
 */
export const effective_mp_max = entity =>
  Math.max(0, entity.mp_max + active_pool_modifier(entity, 'mp'))
