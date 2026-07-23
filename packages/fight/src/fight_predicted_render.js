// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/fight_predicted_render.js — the SIM-prediction render path: run the deterministic @aresrpg/sim command
// and turn its semantic output into renderer-neutral, ordered queue beats. Split out of fight_render_events.js
// (the ≤600-LoC law); register #60 called this lane dormant at the split — STALE since cd383d920 (2026-07-19)
// wired DungeonBoard.jsx's optimistic_cast to dispatch `prediction.beats` straight from here, so this is now the
// LIVE producer behind every own-cast prediction. The RECEIPT render path (produce_receipt_render_turns) stays
// in fight_render_events.js — both share the pure primitives in fight_render_prims.js.

import { reduce } from '@aresrpg/sim/reduce'

import {
  CAST_BEAT_MS,
  create_writer,
  DAMAGE_BEAT_MS,
  DISPLACE_TELEPORT,
  displacement_duration,
  entity_cell,
  FIGHT_RENDER_TIMINGS,
  move_duration,
  move_mp_spent,
  path_between,
  same_cell,
  TELEPORT_ARRIVAL_MS,
  TRAP_BEAT_MS,
  trap_covers,
  traps_added,
  traps_removed,
} from './fight_render_prims.js'

const write_damage = (append, effect, source_turn, source_event) => {
  if (effect.damage !== undefined) {
    // #170 (5th recurrence, RE-BEAT flavor): no separate 'death' beat here either — see fight_render_events.js's
    // write_receipt_effects for the full rationale. `killed` stays as enrichment on the damage beat; the presenter
    // fires the death visual off the presented-state alive→dead edge, once, whichever source re-asserts the kill.
    append(
      'damage',
      DAMAGE_BEAT_MS,
      {
        target_id: effect.target_id,
        damage: effect.damage,
        new_health: effect.new_health,
        killed: !!effect.killed,
        source_event,
      },
      source_turn
    )
  } else if (effect.heal !== undefined) {
    append(
      'heal',
      DAMAGE_BEAT_MS,
      {
        target_id: effect.target_id,
        heal: effect.heal,
        new_health: effect.new_health,
        source_event,
      },
      source_turn
    )
  }
}

const write_sim_statuses = ({ append, effects, source_turn, source_event, added_traps = [] }) => {
  // Placement/status changes happen at this cast beat, never at end-turn commit. TRAP uses its cast target and the
  // concrete post-reduce trap so the render closure can be completely built when the event is enqueued.
  for (const effect of effects.filter((candidate) => candidate.status)) {
    if (effect.status === 'TRAP') {
      const trap = added_traps.find((candidate) => same_cell(candidate.anchor, source_event.target)) ?? added_traps[0]
      append(
        'trap_place',
        FIGHT_RENDER_TIMINGS.instant,
        {
          entity_id: source_event.entity_id,
          target_id: effect.target_id,
          cell: source_event.target,
          trap: trap ?? null,
          source_event,
        },
        source_turn
      )
    } else {
      append(
        'status',
        FIGHT_RENDER_TIMINGS.instant,
        {
          target_id: effect.target_id,
          status: effect.status,
          source_event,
        },
        source_turn
      )
    }
  }
}

const write_sim_effects = ({
  append,
  effects,
  before,
  after,
  source_turn,
  source_event,
  removed_traps = [],
  teleport_ids,
}) => {
  const positions = effects.filter((effect) => effect.has_cell && effect.cell)

  // The sim's displacement sink returns trap/collision damage before its final `{cell, has_cell}` effect. The
  // renderer contract is the opposite: finish the slide first, then detonate and land damage.
  for (const effect of positions) {
    const from = entity_cell(before, effect.target_id)
    // TELEPORT (register #26) is an INSTANT relocation — an EMPTY path at ZERO duration so the entity blinks to the
    // landing cell instead of lerping across it (the SLIDE-BACK class). Mirrors the receipt path's teleport arm;
    // effect_kind rides the beat (field-identical to the chain's Displaced.kind). PUSH/PULL keep their cardinal slide.
    const teleport = !!teleport_ids?.has(effect.target_id)
    const path = teleport ? [] : path_between(from, effect.cell)
    append(
      'displacement',
      teleport ? FIGHT_RENDER_TIMINGS.instant : displacement_duration(path),
      {
        target_id: effect.target_id,
        from,
        to: effect.cell,
        path,
        ...(teleport ? { effect_kind: DISPLACE_TELEPORT } : {}),
        source_event,
      },
      source_turn
    )
    // TELEPORT ARRIVAL — mirrors the receipt path's teleport arm (fight_render_events.js write_receipt_effects):
    // a third beat gated behind the blink, anchored at the landing cell — sequenced after the vfx, with its own
    // vfx at the target too. Never emitted for a push/pull slide.
    if (teleport)
      append(
        'teleport_arrival',
        TELEPORT_ARRIVAL_MS,
        { target_id: effect.target_id, cell: effect.cell, source_event },
        source_turn
      )
  }

  const triggered = removed_traps.filter((trap) => positions.some((effect) => trap_covers(trap, effect.cell)))
  for (const trap of triggered) {
    const position = positions.find((effect) => trap_covers(trap, effect.cell))
    const damage = effects
      .filter((effect) => effect.target_id === position?.target_id)
      .reduce((sum, effect) => sum + Math.max(0, Number(effect.damage) || 0), 0)
    append(
      'trap_trigger',
      TRAP_BEAT_MS,
      {
        entity_id: position?.target_id ?? null,
        target_id: position?.target_id ?? null,
        cell: position?.cell ?? trap.anchor ?? trap.cells?.[0] ?? null,
        trap,
        damage,
        source_event,
      },
      source_turn
    )
  }

  for (const effect of effects) write_damage(append, effect, source_turn, source_event)
}

const sim_source_turn = (state, command, event) => {
  const entity_id = event.entity_id ?? command.entity_id ?? 'fight'
  return `${entity_id}:${state.turn_number ?? 0}`
}

/**
 * Run the deterministic sim command and turn its semantic output into renderer-neutral, ordered queue specs.
 * The returned state is the sim's authoritative predicted next state; callers enqueue `events` immediately.
 */
export function produce_predicted_render_events(state, command, ctx) {
  const result = reduce(state, command, ctx)
  const teleport_ids = ctx?.teleport_ids
  const writer = create_writer()
  const removed_traps = traps_removed(state, result.state)
  const added_traps = traps_added(state, result.state)

  for (const event of result.events) {
    const source_turn = sim_source_turn(state, command, event)
    const { append } = writer
    if (event.type === 'fight_moved') {
      const path = event.path ?? []
      // mp_spent = the traversed cells (twin of the receipt lane). Under THE TOLL (ruling #239) a tackled
      // fight_moved carries the ACTUAL walked prefix (0 cells only when the tax zeroed MP), so mp_spent is just
      // the path length — the walk's own MP spend; the tackle's pool TAX rides its separate Tackled beat.
      append('move', move_duration(path), { ...event, mp_spent: move_mp_spent(path) }, source_turn)
      append(
        'arrival',
        FIGHT_RENDER_TIMINGS.instant,
        {
          entity_id: event.entity_id,
          cell: path.at(-1) ?? entity_cell(result.state, event.entity_id),
          mp_remaining: event.mp_remaining,
          source_event: event,
        },
        source_turn
      )
    } else if (event.type === 'fight_trap_triggered') {
      append(
        'trap_trigger',
        TRAP_BEAT_MS,
        {
          entity_id: event.entity_id,
          target_id: event.entity_id,
          cell: event.cell,
          trap: removed_traps.find((trap) => trap_covers(trap, event.cell)) ?? null,
          source_event: event,
        },
        source_turn
      )
      write_sim_effects({
        append,
        effects: event.effects ?? [],
        before: state,
        after: result.state,
        source_turn,
        source_event: event,
      })
    } else if (event.type === 'fight_cast') {
      write_sim_statuses({
        append,
        effects: event.effects ?? [],
        source_turn,
        source_event: event,
        added_traps,
      })
      append(
        'cast',
        CAST_BEAT_MS,
        {
          fight_id: event.fight_id,
          entity_id: event.entity_id,
          spell_id: event.spell_id,
          target: event.target,
          is_critical: event.is_critical,
          ap_remaining: event.ap_remaining,
          source_event: event,
        },
        source_turn
      )
      write_sim_effects({
        append,
        effects: event.effects ?? [],
        before: state,
        after: result.state,
        source_turn,
        source_event: event,
        removed_traps,
        teleport_ids,
      })
    } else if (event.type === 'fight_turn_effects') {
      write_sim_effects({
        append,
        effects: event.effects ?? [],
        before: state,
        after: result.state,
        source_turn,
        source_event: event,
      })
    } else if (event.type === 'fight_turn_start') {
      append('turn_start', 0, { ...event }, source_turn)
    } else if (event.type === 'fight_turn_end') {
      append('turn_end', 0, { ...event }, source_turn)
    } else if (event.type === 'fight_turn_skipped') {
      append('turn_skip', 0, { ...event }, source_turn)
    } else if (event.type === 'fight_ended') {
      append('fight_end', 0, { ...event }, source_turn)
    }
  }

  return {
    state: result.state,
    sim_events: result.events,
    events: writer.events(),
    total_duration: writer.duration(),
  }
}
