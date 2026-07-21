// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { decode_fight_event } from '@aresrpg/sdk/fight'

import {
  CAST_BEAT_MS,
  cell_key,
  create_writer,
  DAMAGE_BEAT_MS,
  DEATH_BEAT_MS,
  decoded_cell,
  DISPLACE_TELEPORT,
  displacement_duration,
  encoded_cell,
  FIGHT_RENDER_TIMINGS,
  move_duration,
  move_mp_spent,
  path_between,
  reconstructed_path,
  TELEPORT_ARRIVAL_MS,
  TRAP_BEAT_MS,
} from './fight_render_prims.js'

// The reference gaits + timing constants and the pure grid/path/writer primitives live in fight_render_prims.js;
// the SIM-prediction render path (also a live producer — DungeonBoard.jsx's own-cast prediction) lives in
// fight_predicted_render.js (the ≤600-LoC split). Re-export the public timing surface + the predicted entry
// point so consumers keep importing them from this module.
export { DISPLACEMENT_CELL_MS, REFERENCE_GAITS } from './fight_render_prims.js'
export { CAST_BEAT_MS, DAMAGE_BEAT_MS, DEATH_BEAT_MS, FIGHT_RENDER_TIMINGS, TELEPORT_ARRIVAL_MS, TRAP_BEAT_MS }
export { produce_predicted_render_events } from './fight_predicted_render.js'

const decode_receipt_events = (raw_events, fight_id) =>
  raw_events.flatMap((raw_event, event_index) => {
    const decoded = decode_fight_event(raw_event)
    if (!decoded || (fight_id && decoded.fight !== fight_id)) return []
    return [{ ...decoded, event_index }]
  })

const default_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'mob' : 'player'}-${idx}`

// The PENDING WINDOW (register #27 · #290): event kinds that BUFFER into `pending` until their Cast/Move opens a
// turn, instead of tripping the else-branch's `flush_pending()`. Two classes: effects that render off their Cast
// (Displaced/Hit/Drain/StanceChanged), and no-beat bookkeeping that must merely NOT trip a premature flush
// (Revealed/CriticalFailure + the ACTION ENVELOPE ActionStarted/ActionEffect/ActionResolved). A real receipt emits
// effects BEFORE the Cast with a mid-action ActionEffect between them (Hit,Hit,ActionEffect,Cast); membership here
// keeps the kill Hits buffered so they group into their Cast's turn — never orphaned into a bare non-local 'fight'
// turn that re-paces an already-presented kill (#290: the death that "played forever, rolled back under committed-dead").
const PENDING_WINDOW_KINDS = new Set([
  'Displaced',
  'Hit',
  'Drain',
  'StanceChanged',
  'Revealed',
  'CriticalFailure',
  'ActionStarted',
  'ActionEffect',
  'ActionResolved',
])

const fighter_id_from = (event, role, resolve_fighter_id) => {
  const prefix = role === 'caster' ? 'caster' : role === 'victim' ? 'victim' : role === 'target' ? 'target' : null
  const is_mob = role === 'mob' ? true : prefix ? !!event[`${prefix}_is_mob`] : !!event.is_mob
  const idx = Number(prefix ? event[`${prefix}_idx`] : event.idx)
  const character = role === 'mover' ? event.character : undefined
  return resolve_fighter_id({ is_mob, idx, character, role, event })
}

const trap_matcher = (trap_cells, is_trap_cell, width) => {
  const values = trap_cells ? [...trap_cells] : []
  const keys = new Set(
    values.map((value) =>
      typeof value === 'number' || typeof value === 'bigint' ? `#${Number(value)}` : cell_key(value)
    )
  )
  return (cell, encoded, event) =>
    !!is_trap_cell?.(cell, encoded, event) || keys.has(`#${Number(encoded)}`) || keys.has(cell_key(cell))
}

const receipt_path = (event, width) => {
  const from = decoded_cell(event.from_cell, width)
  const to = decoded_cell(event.to_cell, width)
  return { from, to, path: path_between(from, to) }
}

/**
 * Decode a real receipt and normalize its effects-before-Cast emitter order into semantic source-turn timelines.
 * `trap_cells` accepts encoded cells or `{x,y}` cells. Callers may inject identity/path/cast resolvers from the
 * authoritative fight snapshot without coupling this pure producer to the store.
 */
export function produce_receipt_render_turns(
  raw_events,
  {
    fight_id = null,
    grid_width = 20,
    trap_cells = [],
    is_trap_cell = null,
    resolve_fighter_id = default_fighter_id,
    fighter_cells = null,
    fighter_health = null,
    move_path = null,
    resolve_cast = null,
    // Board terrain facts (board_state.js decode shape) — OPTIONAL. Feeds `reconstructed_path` so a Moved/
    // MobMoved beat with no `move_path` resolver reconstructs an obstacle-aware walk instead of a naive
    // straight line (the mob-crossed-obstacle bug, design ruling 2026-07-19). Absent ⇒ prior straight-line behavior.
    obstacles = null,
    holes = null,
    shape_mask = null,
    board_width = null,
    board_height = null,
  } = {}
) {
  const decoded_events = decode_receipt_events(raw_events, fight_id)
  const turns = []
  const turn_writers = new Map()
  const turn_counts = new Map()
  const matches_trap = trap_matcher(trap_cells, is_trap_cell, grid_width)
  const hit_damage = new Map()
  const remaining_health = new Map()
  let current_turn = null
  let pending = []
  let active_move = null
  const settled_cells = new Map() // receipt-local landing cells — later walks originate where the slide ended (§7b)

  // Chain Hit.amount is raw authored damage while remaining_hp is saturated. Price every confirmed floater from
  // the victim's pre-receipt HP, then carry remaining_hp forward for later hits in this same receipt.
  for (const event of decoded_events.filter((candidate) => candidate.kind === 'Hit')) {
    const target_id = fighter_id_from(event, 'victim', resolve_fighter_id)
    let hp_before = remaining_health.get(target_id)
    if (hp_before == null) {
      const known =
        typeof fighter_health === 'function'
          ? fighter_health(target_id, event)
          : (fighter_health?.get?.(target_id) ?? fighter_health?.[target_id])
      if (known != null && Number.isFinite(Number(known))) hp_before = Math.max(0, Number(known))
    }
    const raw_amount = Math.max(0, Number(event.amount) || 0)
    hit_damage.set(event.event_index, hp_before == null ? raw_amount : Math.min(raw_amount, hp_before))
    const remaining_hp = Number(event.remaining_hp)
    if (Number.isFinite(remaining_hp)) remaining_health.set(target_id, Math.max(0, remaining_hp))
    else if (hp_before != null) remaining_health.set(target_id, Math.max(0, hp_before - raw_amount))
  }

  const damage_of_hit = (event) => hit_damage.get(event.event_index) ?? Math.max(0, Number(event.amount) || 0)

  const ensure_turn = (source_id, force_new = false, source = null) => {
    if (!force_new && current_turn?.source_id === source_id) return current_turn
    const ordinal = turn_counts.get(source_id) ?? 0
    turn_counts.set(source_id, ordinal + 1)
    current_turn = { source_id, source, source_turn: `${source_id}:${ordinal}`, events: [] }
    turns.push(current_turn)
    turn_writers.set(current_turn, create_writer())
    return current_turn
  }

  const append_to = (turn, kind, duration, payload) => {
    const event = turn_writers.get(turn).append(kind, duration, payload, turn.source_turn)
    turn.events.push(event)
    return event
  }

  const write_receipt_effects = (turn, effects) => {
    const displaced = effects.filter((event) => event.kind === 'Displaced')
    const trap_displacements = []
    for (const event of displaced) {
      const target_id = fighter_id_from(event, 'target', resolve_fighter_id)
      // TELEPORT (effect_kind 14, the mechanics code — DISPLACE_TELEPORT) is an INSTANT relocation, never a
      // cardinal slide (register #26): from→to with an EMPTY path and ZERO duration, so the entity blinks to the
      // landing cell instead of stepping ~119ms/cell across it (the D420 spectator/receipt half). PUSH/PULL slide.
      const teleport = Number(event.effect_kind) === DISPLACE_TELEPORT
      const movement = teleport
        ? { from: decoded_cell(event.from_cell, grid_width), to: decoded_cell(event.to_cell, grid_width), path: [] }
        : receipt_path(event, grid_width)
      settled_cells.set(target_id, movement.to)
      append_to(turn, 'displacement', teleport ? FIGHT_RENDER_TIMINGS.instant : displacement_duration(movement.path), {
        target_id,
        ...movement,
        requested: event.requested,
        blocked: event.blocked,
        effect_kind: event.effect_kind,
        source_event: event,
      })
      // TELEPORT ARRIVAL — the teleport sequences after the vfx, with its own vfx at the target too: a THIRD,
      // gated beat gets appended right after the blink — the writer's `at` already
      // accumulated past the cast beat's full duration then the (zero) displacement, so this beat can only ever
      // render once both have. Anchored at the landing cell; push/pull never get one (they slide, they don't blink).
      if (teleport)
        append_to(turn, 'teleport_arrival', TELEPORT_ARRIVAL_MS, { target_id, cell: movement.to, source_event: event })
      if (matches_trap(movement.to, event.to_cell, event)) trap_displacements.push({ event, target_id, movement })
    }
    for (const { event, target_id, movement } of trap_displacements)
      append_to(turn, 'trap_trigger', TRAP_BEAT_MS, {
        entity_id: target_id,
        target_id,
        cell: movement.to,
        damage: effects
          .filter(
            (candidate) =>
              candidate.kind === 'Hit' &&
              candidate.event_index > event.event_index &&
              fighter_id_from(candidate, 'victim', resolve_fighter_id) === target_id
          )
          .reduce((sum, candidate) => sum + damage_of_hit(candidate), 0),
        source_event: event,
      })

    // #170 (5th recurrence, the RE-BEAT flavor): a 'death' beat used to be appended here for every zero-HP Hit —
    // one per PRODUCER call, so a receipt wave + a poll's spectator replay + a second poll each built their OWN
    // redundant death beat for the SAME kill (no canonical identity, no dedup). Death is no longer an event-
    // triggered beat kind at all: the 'damage' beat's `killed` flag stays as CAUSE enrichment (who died, from
    // what), but the PRESENTER (voxel_fight_adapter.js) is the sole trigger — it fires the death visual off the
    // PRESENTED-STATE alive→dead EDGE (a fold over `dead: boolean` per fighter, `!==` comparison — the reduce/
    // observe idiom this studio has used since aresrpg-legacy's player_health.js health-fold). A replayed "he's
    // dead" signal changes nothing (state is already dead ⇒ no edge ⇒ no beat) — once-only by construction,
    // whichever of the N sources re-asserts it. See project.death_presenting_ids / fold.death_presenting_keys —
    // both now hold on `damage`+`killed` instead of a `death` beat kind.
    for (const event of effects.filter((candidate) => candidate.kind === 'Hit')) {
      const target_id = fighter_id_from(event, 'victim', resolve_fighter_id)
      append_to(turn, 'damage', DAMAGE_BEAT_MS, {
        target_id,
        damage: damage_of_hit(event),
        new_health: event.remaining_hp,
        killed: event.remaining_hp === 0,
        source_event: event,
      })
    }

    for (const event of effects.filter((candidate) => candidate.kind === 'Drain'))
      append_to(turn, 'status', 0, {
        target_id: fighter_id_from(event, 'target', resolve_fighter_id),
        status: 'DRAIN',
        source_event: event,
      })
    for (const event of effects.filter((candidate) => candidate.kind === 'StanceChanged'))
      append_to(turn, 'status', 0, {
        target_id: fighter_id_from(event, 'target', resolve_fighter_id),
        status: 'STANCE',
        source_event: event,
      })
  }

  const flush_pending = (turn = current_turn) => {
    if (pending.length === 0) return
    const target = turn ?? ensure_turn('fight')
    write_receipt_effects(target, pending)
    pending = []
  }

  for (const event of decoded_events) {
    if (PENDING_WINDOW_KINDS.has(event.kind)) {
      // These BUFFER into `pending` (below) rather than trip the else-branch's premature `flush_pending()` — the
      // #290 fix. write_receipt_effects renders only Displaced/Hit/Drain/StanceChanged; the action envelope +
      // Revealed/CriticalFailure carry no beat and are inert once flushed. See PENDING_WINDOW_KINDS for the why.
      if (event.kind === 'Hit' && active_move?.trap) {
        const target_id = fighter_id_from(event, 'victim', resolve_fighter_id)
        if (target_id === active_move.source_id) {
          if (!active_move.triggered) {
            append_to(active_move.turn, 'trap_trigger', TRAP_BEAT_MS, {
              entity_id: target_id,
              target_id,
              cell: active_move.cell,
              damage: damage_of_hit(event),
              source_event: event,
            })
            active_move.triggered = true
          }
          write_receipt_effects(active_move.turn, [event])
          continue
        }
      }
      pending.push(event)
      continue
    }

    if (event.kind === 'Cast') {
      const source_id = fighter_id_from(event, 'caster', resolve_fighter_id)
      const turn = ensure_turn(source_id, false, {
        is_mob: !!event.caster_is_mob,
        idx: Number(event.caster_idx),
      })
      const cast = resolve_cast?.(event) ?? {}
      for (const status of cast.statuses ?? [])
        append_to(turn, status.status === 'TRAP' ? 'trap_place' : 'status', 0, {
          ...status,
          entity_id: source_id,
          cell: status.cell ?? decoded_cell(event.target_cell, grid_width),
          source_event: event,
        })
      append_to(turn, 'cast', CAST_BEAT_MS, {
        fight_id: event.fight,
        entity_id: source_id,
        target: decoded_cell(event.target_cell, grid_width),
        ...cast,
        source_event: event,
      })
      write_receipt_effects(turn, pending)
      pending = []
      active_move = null
      continue
    }

    if (event.kind === 'Moved' || event.kind === 'MobMoved') {
      flush_pending()
      const role = event.kind === 'Moved' ? 'mover' : 'mob'
      const source_id = fighter_id_from(event, role, resolve_fighter_id)
      const turn = ensure_turn(
        source_id,
        false,
        event.kind === 'Moved' ? { character: event.character } : { is_mob: true, idx: Number(event.idx) }
      )
      const to = decoded_cell(event.to_cell, grid_width)
      const known_from =
        settled_cells.get(source_id) ??
        (typeof fighter_cells === 'function'
          ? fighter_cells(source_id, event)
          : (fighter_cells?.get?.(source_id) ?? fighter_cells?.[source_id] ?? null))
      settled_cells.set(source_id, to)
      // INGESTION ASSERT (P0 move_path crash guard): move_path is a RESOLVER function or null. A non-null
      // non-function — a producer passing a raw path ARRAY — is the S2 "instanceof Array" crash: `move_path?.(…)`
      // throws "x is not a function" and takes the whole fight render down. Mirror the fighter_cells typeof guard
      // above (:522): call a real resolver, treat null as "no resolver", and make a MIS-TYPED producer loud in
      // dev/test (caught at the boundary, never re-shipped) while degrading to path_between in prod (users never
      // see a thrown beat — the client-independence law: render the derived path, reconcile later).
      let supplied_path = null
      if (typeof move_path === 'function') supplied_path = move_path(event, source_id, known_from, to)
      else if (move_path != null && !import.meta.env?.PROD)
        throw new TypeError(
          `fight render: move_path must be a resolver function or null, got ${Array.isArray(move_path) ? 'Array' : typeof move_path}`
        )
      const path =
        supplied_path ??
        reconstructed_path(known_from, to, {
          obstacles,
          holes,
          shape_mask,
          board_width,
          board_height,
          width: grid_width,
        })
      const rendered_path = path.length > 0 ? path : [to]
      append_to(turn, 'move', move_duration(rendered_path), {
        fight_id: event.fight,
        entity_id: source_id,
        path: rendered_path,
        mp_spent: move_mp_spent(rendered_path), // green MP-spent floater (§ move beat carries no chain cost)
        source_event: event,
      })
      append_to(turn, 'arrival', 0, {
        entity_id: source_id,
        cell: to,
        source_event: event,
      })
      active_move = {
        source_id,
        turn,
        cell: to,
        trap: matches_trap(to, event.to_cell, event),
        triggered: false,
      }
      continue
    }

    if (event.kind === 'Tackled') {
      // TACKLE BITE — a tackled player plays the hit animation just before moving:
      // the runner's flinch + pool-forfeit beat, appended IN EVENT ORDER — the chain emits Tackled at the
      // denial and a later successful retry emits its own Moved, so this beat lands STRICTLY BEFORE that move
      // on the runner's writer clock (at-chaining), never after, never merged. Standing alone (no retry) it IS
      // the MP-forfeit presentation. u64 fields ride as strings off Sui JSON — coerce here, the renderer reads
      // numbers. num/den stay on source_event for anyone pricing the contest; the beat carries the losses.
      flush_pending()
      active_move = null
      const runner_is_mob = !!event.runner_is_mob
      const idx = Number(event.runner_idx)
      const source_id = resolve_fighter_id({ is_mob: runner_is_mob, idx, role: 'runner', event })
      const turn = ensure_turn(source_id, false, { is_mob: runner_is_mob, idx })
      append_to(turn, 'tackled', DAMAGE_BEAT_MS, {
        entity_id: source_id,
        target_id: source_id,
        ap_lost: Number(event.ap_lost) || 0,
        mp_lost: Number(event.mp_lost) || 0,
        source_event: event,
      })
      continue
    }

    flush_pending()
    active_move = null
    if (event.kind === 'TurnStarted' || event.kind === 'TurnEnded') {
      const source_id = fighter_id_from(event, 'turn', resolve_fighter_id)
      const turn = ensure_turn(source_id, event.kind === 'TurnStarted', {
        is_mob: !!event.is_mob,
        idx: Number(event.idx),
      })
      append_to(turn, event.kind === 'TurnStarted' ? 'turn_start' : 'turn_end', 0, {
        source_event: event,
      })
      if (event.kind === 'TurnEnded') current_turn = null
    } else if (event.kind === 'Victory' || event.kind === 'Defeat') {
      const turn = current_turn ?? ensure_turn('fight')
      append_to(turn, 'fight_end', 0, { outcome: event.kind, source_event: event })
    }
  }
  flush_pending()

  return {
    decoded_events,
    turns,
    events: turns.flatMap((turn) => turn.events),
    total_duration: turns.reduce((sum, turn) => sum + turn_writers.get(turn).duration(), 0),
  }
}

// Kept exported for queue adapters that receive an encoded cell but need the same deterministic grid conversion.
export const fight_render_cell = (encoded, width = 20) => decoded_cell(encoded, width)
export const fight_render_encoded_cell = (cell, width = 20) => encoded_cell(cell, width)
