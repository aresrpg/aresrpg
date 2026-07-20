// Trap + glyph placement and triggers.
//
// PORTED from koshi-2d/.../shared/src/fight/spell_processing/placement.ts. Determinism fixes vs the donor:
//   - ids: globalThis.crypto.randomUUID() -> the state's monotonic next_id counter.
//   - damage: calculate_final_damage returns {rng, damage} here (rng threaded) — never Math.random. Board damage
//     is ZERO-CASTER (chain parity, cast.move::apply_board_batch &ZERO): the target resists, the placer never amplifies.
// A trap is placed on a CASTER-only-visible cell set; it triggers on the FIRST entity to step onto a covered
// cell (during a move OR a push), is removed, and deals the trap's element damage. A glyph persists for N
// turns and triggers on TURN_START for any entity standing on it.

import { next_id, find_entity, effective_stats } from './fight_state.js'
import { apply_incoming_damage } from './fight_actions.js'
import { calculate_final_damage } from './spell_calculator.js'
import { get_direction, handle_displacement } from './fight_displacement.js'

/**
 * Place a trap covering `cells` (donor place_trap). Returns the new state + the trap id (next_id).
 * `anchor` = the CAST TARGET cell the trap is anchored on — the 1.29 no-stack ban is per-ANCHOR (validate_cast
 * refuses a trap cast targeting a live trap's anchor; overlapping blast zones stay legal, chain parity with
 * aresrpg_fight::cast ECellAlreadyTrapped).
 * @param {import('./fight_state.js').FightState} state
 * @param {string} caster_id
 * @param {import('./cell.js').Cell[]} cells
 * @param {import('./spell_templates.js').SpellEffect[]} payload
 * @param {import('./cell.js').Cell} [anchor]
 * @returns {import('./fight_state.js').FightState}
 */
export const place_trap = (state, caster_id, cells, payload, anchor) => {
  const { state: s2, id } = next_id(state)
  return {
    ...s2,
    traps: [...s2.traps, { id, source_id: caster_id, cells, payload, anchor }],
  }
}

/**
 * Place a glyph covering `cells` for `turns` turns. Two shapes, mirroring the chain's payload glyph and the
 * sim's own trap model: a PAYLOAD glyph carries sibling effects applied to the standing fighter each tick
 * (spell_board::place_glyph + tick_start/tick_end); a LEGACY glyph carries element/min/max damage. `payload`
 * (may be empty) takes precedence at tick time; element/min/max are the legacy fallback.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} caster_id
 * @param {import('./cell.js').Cell[]} cells
 * @param {import('./fight_state.js').Element|undefined} element
 * @param {number|undefined} min
 * @param {number|undefined} max
 * @param {number} turns
 * @param {import('./spell_templates.js').SpellEffect[]} [payload]
 * @returns {import('./fight_state.js').FightState}
 */
export const place_glyph = (
  state,
  caster_id,
  cells,
  element,
  min,
  max,
  turns,
  payload = [],
) => {
  const { state: s2, id } = next_id(state)
  return {
    ...s2,
    glyphs: [
      ...s2.glyphs,
      {
        id,
        source_id: caster_id,
        cells,
        element,
        min,
        max,
        turns_remaining: turns,
        payload,
      },
    ],
  }
}

/**
 * Compute a trap/glyph's damage on `entity`, rng threaded. ZERO-CASTER parity with the chain
 * (cast.move::apply_board_batch — `final_damage(base, el, &ZERO, target_stats)`): a board hazard NEVER amplifies
 * off the placer's live stats (dead/anonymous by detonation time) — only the target's resistances + shields apply.
 * @param {import('./fight_state.js').FightState} state
 * @param {{ element: import('./fight_state.js').Element, min: number, max: number }} hazard
 * @param {import('./fight_state.js').FightEntity} entity
 * @returns {{ rng: import('./prng.js').Rng, damage: number }}
 */
const hazard_damage = (state, hazard, entity) => {
  const res = calculate_final_damage(
    state.rng,
    {
      type: /** @type {const} */ ('DAMAGE'),
      element: hazard.element,
      min: hazard.min,
      max: hazard.max,
    },
    {}, // ZERO caster — no placer amplification (chain &ZERO)
    effective_stats(entity),
    1,
    entity.effects.filter(e => e.type === 'SHIELD'),
  )
  return { rng: res.rng, damage: res.damage }
}

const hazard_hit = (state, target_id, damage, source_id) => {
  const hit = apply_incoming_damage(state, target_id, damage, source_id)
  const recipient = find_entity(hit.state, hit.recipient_id)
  return {
    state: hit.state,
    effects: [
      ...(hit.heal_dealt > 0
        ? [
            {
              target_id,
              heal: hit.heal_dealt,
              new_health: find_entity(hit.state, target_id)?.health ?? 0,
            },
          ]
        : [
            {
              target_id: hit.recipient_id,
              damage: hit.damage_dealt,
              new_health: recipient?.health ?? 0,
              killed: hit.killed,
            },
          ]),
      ...hit.effects,
    ],
  }
}

/**
 * Apply a board-hazard PAYLOAD (a trap detonation or a glyph tick) to `entity_id`, rng threaded through state.
 * Element damage lines scale off the placer's stats; PUSH/PULL displace from `anchor` (the placement cell) and
 * recurse through traps. The single home shared by trap detonation and glyph ticking (chain parity: both route
 * a payload through the effect dispatch). Effects it does not model are skipped (never a crash).
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./spell_templates.js').SpellEffect[]} payload
 * @param {string} entity_id
 * @param {string} source_id  the placer (stat scaling + attribution)
 * @param {import('./cell.js').Cell} [anchor]  displacement origin
 * @param {(cell: import('./cell.js').Cell) => boolean} [terrain_walkable]
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
const apply_payload = (
  state,
  payload,
  entity_id,
  source_id,
  anchor,
  terrain_walkable = () => true,
) =>
  payload.reduce(
    (acc, effect) => {
      const target = find_entity(acc.state, entity_id)
      if (!target || target.health <= 0) return acc
      if (
        (effect.type === 'DAMAGE' ||
          effect.type === 'POISON' ||
          effect.type === 'STEAL') &&
        effect.element !== undefined &&
        effect.min !== undefined &&
        effect.max !== undefined
      ) {
        const { rng, damage } = hazard_damage(
          acc.state,
          /** @type {{ element: import('./fight_state.js').Element, min: number, max: number, source_id: string }} */ ({
            ...effect,
            source_id,
          }),
          target,
        )
        const after = hazard_hit(
          { ...acc.state, rng },
          entity_id,
          damage,
          source_id,
        )
        return {
          state: after.state,
          effects: [...acc.effects, ...after.effects],
        }
      }
      if (effect.type === 'PUSH' || effect.type === 'PULL') {
        const origin = anchor ?? target.cell
        const direction =
          effect.type === 'PUSH'
            ? get_direction(origin, target.cell)
            : get_direction(target.cell, origin)
        const caster_level = find_entity(acc.state, source_id)?.level ?? 1
        const displaced = handle_displacement(
          acc.state,
          entity_id,
          direction,
          effect.distance ?? 1,
          caster_level,
          terrain_walkable,
          (next_state, next_cell, target_id) =>
            check_traps(next_state, next_cell, target_id, terrain_walkable),
          source_id,
        )
        return {
          state: displaced.state,
          effects: [...acc.effects, ...displaced.effects],
        }
      }
      return acc
    },
    {
      state,
      effects:
        /** @type {import('./fight_spells.js').SpellCastEffect[]} */ ([]),
    },
  )

/**
 * Check whether stepping onto `cell` triggers a trap; if so remove the trap, deal its damage, and report it.
 * Donor check_traps (placement.ts:41). rng threaded through state.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./cell.js').Cell} cell
 * @param {string} entity_id  the entity stepping onto the cell
 * @param {(cell: import('./cell.js').Cell) => boolean} [terrain_walkable]
 * @returns {{ state: import('./fight_state.js').FightState, triggered: boolean, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const check_traps = (
  state,
  cell,
  entity_id,
  terrain_walkable = () => true,
) => {
  const index = state.traps.findIndex(t =>
    t.cells.some(c => c.x === cell.x && c.y === cell.y),
  )
  if (index === -1) return { state, triggered: false, effects: [] }
  const trap = state.traps[index]
  const entity = find_entity(state, entity_id)
  if (!trap || !entity) return { state, triggered: false, effects: [] }

  // Remove before resolving payload so a repulsive trap cannot recursively trigger itself.
  const without_trap = {
    ...state,
    traps: state.traps.filter((_, i) => i !== index),
  }
  const legacy_payload =
    trap.element && trap.min !== undefined && trap.max !== undefined
      ? [
          {
            type: /** @type {const} */ ('DAMAGE'),
            element: trap.element,
            min: trap.min,
            max: trap.max,
          },
        ]
      : []
  const payload = trap.payload ?? legacy_payload
  const resolved = apply_payload(
    without_trap,
    payload,
    entity_id,
    trap.source_id,
    trap.anchor,
    terrain_walkable,
  )
  return {
    state: resolved.state,
    triggered: true,
    effects: resolved.effects,
  }
}

/**
 * Trigger every glyph covering `entity_id`'s current cell (donor check_glyphs; persistent — NOT removed).
 * Called at TURN_START. rng threaded across all matching glyphs.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[] }}
 */
export const check_glyphs = (state, entity_id) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return { state, effects: [] }
  const covering = state.glyphs.filter(g =>
    g.cells.some(c => c.x === entity.cell.x && c.y === entity.cell.y),
  )
  return covering.reduce(
    (acc, glyph) => {
      const here = find_entity(acc.state, entity_id)
      if (!here || here.health <= 0) return acc
      // PAYLOAD glyph (chain payload model) → apply its sibling effects to the standing fighter (anchored at
      // the glyph's own cell for any displacement). LEGACY element/min/max glyph → the flat damage tick.
      if (glyph.payload && glyph.payload.length > 0) {
        const applied = apply_payload(
          acc.state,
          glyph.payload,
          entity_id,
          glyph.source_id,
          glyph.cells[0],
        )
        return {
          state: applied.state,
          effects: [...acc.effects, ...applied.effects],
        }
      }
      if (
        glyph.element === undefined ||
        glyph.min === undefined ||
        glyph.max === undefined
      )
        return acc
      const { rng, damage } = hazard_damage(
        acc.state,
        {
          element: glyph.element,
          min: glyph.min,
          max: glyph.max,
          source_id: glyph.source_id,
        },
        here,
      )
      const after = hazard_hit(
        { ...acc.state, rng },
        entity_id,
        damage,
        glyph.source_id,
      )
      return {
        state: after.state,
        effects: [...acc.effects, ...after.effects],
      }
    },
    {
      state,
      effects:
        /** @type {import('./fight_spells.js').SpellCastEffect[]} */ ([]),
    },
  )
}

/**
 * Decrement every glyph's turn counter and drop the expired ones. Called once per turn advance.
 * @param {import('./fight_state.js').FightState} state
 * @returns {import('./fight_state.js').FightState}
 */
export const decay_glyphs = state => ({
  ...state,
  glyphs: state.glyphs
    .map(g => ({ ...g, turns_remaining: g.turns_remaining - 1 }))
    .filter(g => g.turns_remaining > 0),
})
