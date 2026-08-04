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
  move_cell_ms,
  move_mp_spent,
  path_between,
  reconstructed_path,
  armed_at,
  placements_by_anchor,
  TELEPORT_ARRIVAL_MS,
  TRAP_BEAT_MS,
} from './fight_render_prims.js'
import { GRID_W } from './los.js'
import { ACTION_EFFECT_EVENT } from './inputs.js'

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
  ACTION_EFFECT_EVENT,
  'ActionResolved',
])

const fighter_id_from = (event, role, resolve_fighter_id) => {
  const prefix =
    role === 'caster'
      ? 'caster'
      : role === 'victim'
        ? 'victim'
        : role === 'target'
          ? 'target'
          : role === 'fighter'
            ? 'fighter'
            : null
  const is_mob = role === 'mob' ? true : prefix ? !!event[`${prefix}_is_mob`] : !!event.is_mob
  const idx = Number(prefix ? event[`${prefix}_idx`] : event.idx)
  const character = role === 'mover' ? event.character : undefined
  return resolve_fighter_id({ is_mob, idx, character, role, event })
}

const position_entries = (positions) => {
  if (positions?.entries) return [...positions.entries()]
  if (positions && typeof positions === 'object') return Object.entries(positions)
  return []
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
 * `trap_cells` accepts encoded cells or `{x,y}` cells. Callers may inject identity/path/cast/trap-owner resolvers
 * from the authoritative fight snapshot without coupling this pure producer to the store.
 */
export function produce_receipt_render_turns(
  raw_events,
  {
    fight_id = null,
    grid_width = GRID_W,
    trap_cells = [],
    trap_rows = [],
    is_trap_cell = null,
    resolve_trap_owner = null,
    resolve_fighter_id = default_fighter_id,
    fighter_cells = null,
    // Every living fighter's PRE-receipt cell. The producer advances this map in receipt order, so each walk
    // freezes the same current body mask as Move (rather than reusing a stale snapshot for a later mover).
    fighter_positions = null,
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
  const available_traps = (trap_rows ?? []).filter((trap) => !trap.gone).map((trap) => ({ trap, consumed: false }))
  const hit_outcomes = new Map()
  const remaining_health = new Map()
  const dead_fighters = new Set()
  // Hits already narrated by the walk that sprang their trap (the Moved/MobMoved branch claims them, in either
  // emitter order), so the main loop never re-renders them.
  const claimed_hits = new Set()
  let current_turn = null
  let pending = []
  const initial_positions = fighter_positions ?? (typeof fighter_cells === 'function' ? null : fighter_cells)
  const settled_cells = new Map(
    position_entries(initial_positions)
      .filter(([, cell]) => cell != null)
      .map(([id, cell]) => [String(id), cell])
  )

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
    const remaining_hp = Number(event.remaining_hp)
    const raw_amount = Math.max(0, Number(event.amount) || 0)
    const healing = hp_before != null && Number.isFinite(remaining_hp) && remaining_hp > hp_before
    // SATURATION IS THE ONLY REASON TO CLAMP (#2151). `Hit.amount` is the raw AUTHORED damage and differs from
    // the HP actually removed in exactly one case: it overshot the life that was there to take. The journal
    // states that case itself — `remaining_hp > 0` is the victim SURVIVING, which is proof nothing saturated, so
    // the raw amount IS the amount and no HP oracle may lower it. Consulting one regardless is what let a client's
    // own reading corrupt a committed fact: on the PRESENTATION-OWED lane (#2124) the adopted snapshot already
    // contains the row's damage, so the oracle answers the victim's POST-hit HP and `min(10, 5)` rendered 5 for a
    // hit the journal recorded as 10 — the acting seat, whose oracle really is pre-receipt, printed 10 (#2145 §5).
    const saturated = !Number.isFinite(remaining_hp) || remaining_hp <= 0
    hit_outcomes.set(event.event_index, {
      kind: healing ? 'heal' : 'damage',
      amount: healing
        ? Math.min(raw_amount, remaining_hp - hp_before)
        : saturated && hp_before != null
          ? Math.min(raw_amount, hp_before)
          : raw_amount,
    })
    if (Number.isFinite(remaining_hp)) remaining_health.set(target_id, Math.max(0, remaining_hp))
    else if (hp_before != null) remaining_health.set(target_id, Math.max(0, hp_before - raw_amount))
  }

  const outcome_of_hit = (event) =>
    hit_outcomes.get(event.event_index) ?? { kind: 'damage', amount: Math.max(0, Number(event.amount) || 0) }
  const damage_of_hit = (event) => {
    const outcome = outcome_of_hit(event)
    return outcome.kind === 'damage' ? outcome.amount : 0
  }

  // WHEN a trap became armed, within THIS receipt (#1219). `my_traps` is written OPTIMISTICALLY at draft time, so
  // by the time a receipt is narrated the client's trap ledger already holds a cell the turn only takes LATER —
  // and matching that cell against an EARLIER walk flashed a detonation on a path the player had already left.
  // The selection rule and its boundary live in ONE home shared with the fold (#1248): this stream's ordinal is
  // the decoded row index, and `armed_at` answers the rest.
  const placements = placements_by_anchor(decoded_events, (candidate) =>
    candidate.kind === 'Cast' ? candidate.target_cell : null
  )
  const armed_before = (encoded, cursor) => armed_at(placements, encoded, cursor)
  const matching_trap = (encoded, cursor, consume = false) => {
    const trap_index = available_traps.findIndex(
      ({ trap, consumed }) =>
        !consumed &&
        (trap.cells ?? []).some((cell) => Number(cell) === Number(encoded)) &&
        armed_before(trap.anchor ?? encoded, cursor)
    )
    if (trap_index === -1) return null
    if (consume) available_traps[trap_index] = { ...available_traps[trap_index], consumed: true }
    return available_traps[trap_index].trap
  }
  const trap_at = (cell, encoded, event, cursor) =>
    available_traps.length > 0 ? matching_trap(encoded, cursor) : matches_trap(cell, encoded, event)

  // ONE home for "which cells did this walk ENTER". A receipt's Moved/MobMoved carries only the landing cell, so
  // the route is reconstructed (obstacle- and body-aware, through the sim's own find_path_4dir) unless the caller
  // resolves it. Both the trap probe and the rendered beats read it, so they can never disagree.
  // INGESTION ASSERT (P0 move_path crash guard): move_path is a RESOLVER function or null. A non-null non-function
  // — a producer passing a raw path ARRAY — is the S2 "instanceof Array" crash: `move_path?.(…)` throws "x is not a
  // function" and takes the whole fight render down. Mirror the fighter_cells typeof guard: call a real resolver,
  // treat null as "no resolver", and make a MIS-TYPED producer loud in dev/test (caught at the boundary, never
  // re-shipped) while degrading to path_between in prod (users never see a thrown beat — the client-independence
  // law: render the derived path, reconcile later).
  const path_for = (event, source_id, from, to) => {
    let supplied_path = null
    if (typeof move_path === 'function') supplied_path = move_path(event, source_id, from, to)
    else if (move_path != null && !import.meta.env?.PROD)
      throw new TypeError(
        `fight render: move_path must be a resolver function or null, got ${Array.isArray(move_path) ? 'Array' : typeof move_path}`
      )
    const occupied_cells = [...settled_cells.entries()].filter(([id]) => id !== source_id).map(([, cell]) => cell)
    // EMPTY MEANS ABSENT (#1649): a resolver that knows no route must be indistinguishable from no resolver at
    // all. `supplied_path ?? …` let an EMPTY array short-circuit reconstruction and fall to the `[to]` default
    // below — ONE hop straight through whatever stood in the way. `local_move_beats` hands its `path` over as
    // exactly this resolver, so the trap sat on the live optimistic-walk lane.
    const path =
      (supplied_path?.length ? supplied_path : null) ??
      reconstructed_path(from, to, {
        obstacles,
        holes,
        shape_mask,
        board_width,
        board_height,
        width: grid_width,
        occupied_cells,
      })
    return path.length > 0 ? path : [to]
  }

  const crosses_trap = (event, source_id, from, to, cursor) =>
    path_for(event, source_id, from, to).some((cell) => {
      const encoded = encoded_cell(cell, grid_width)
      return !!trap_at(cell, encoded, event, cursor) && armed_before(encoded, cursor)
    })

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

  const write_receipt_effects = (turn, effects, attributed_trap_hits = []) => {
    const displaced = effects.filter((event) => event.kind === 'Displaced')
    const trap_displacements = displaced.flatMap((event) => {
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
      const trap = matching_trap(event.to_cell, event.event_index, true)
      return (available_traps.length > 0 ? trap : matches_trap(movement.to, event.to_cell, event))
        ? [
            {
              event,
              target_id,
              movement,
              trap_anchor: trap?.anchor ?? null,
              trap_owner_id: resolve_trap_owner?.(movement.to, event.to_cell, event) ?? null,
            },
          ]
        : []
    })
    const hits_after_trap = ({ event, target_id }) =>
      effects.filter(
        (candidate) =>
          candidate.kind === 'Hit' &&
          candidate.event_index > event.event_index &&
          fighter_id_from(candidate, 'victim', resolve_fighter_id) === target_id
      )
    const detected_trap_hits = trap_displacements.flatMap((trap) =>
      hits_after_trap(trap).map((event) => ({
        event_index: event.event_index,
        trap_owner_id: trap.trap_owner_id,
      }))
    )
    const trap_hits = [...attributed_trap_hits, ...detected_trap_hits]
    for (const { event, target_id, movement, trap_anchor, trap_owner_id } of trap_displacements)
      append_to(turn, 'trap_trigger', TRAP_BEAT_MS, {
        entity_id: target_id,
        target_id,
        cell: movement.to,
        trap_cell: Number(event.to_cell),
        trap_anchor,
        damage: hits_after_trap({ event, target_id }).reduce((sum, candidate) => sum + damage_of_hit(candidate), 0),
        trap_owner_id,
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
      const trap_hit = trap_hits.find((candidate) => candidate.event_index === event.event_index)
      const outcome = outcome_of_hit(event)
      const killed = outcome.kind === 'damage' && Number(event.remaining_hp) === 0
      append_to(turn, outcome.kind, DAMAGE_BEAT_MS, {
        target_id,
        [outcome.kind]: outcome.amount,
        new_health: event.remaining_hp,
        ...(outcome.kind === 'damage' ? { killed } : {}),
        ...(trap_hit ? { trap_damage: true, trap_owner_id: trap_hit.trap_owner_id ?? null } : {}),
        source_event: event,
      })
      if (killed) {
        dead_fighters.add(target_id)
        settled_cells.delete(target_id)
      }
    }

    for (const event of effects.filter((candidate) => candidate.kind === 'Drain')) {
      // The Drain row is the one authoritative dodge outcome: requested is what the cast attempted and removed
      // is what landed. Split that ONE row into the two counts every presenter speaks in — what landed and what
      // the contest ate — so the board, the chat, and any spectator can never disagree about a drain.
      const landed = Math.max(0, Math.trunc(Number(event.removed) || 0))
      const attempted = Math.max(landed, Math.trunc(Number(event.requested) || 0))
      append_to(turn, 'status', 0, {
        target_id: fighter_id_from(event, 'target', resolve_fighter_id),
        caster_id: turn.source_id,
        status: 'DRAIN',
        pool: Number(event.point_kind) === 0 ? 'ap' : 'mp',
        dodged: attempted - landed,
        landed,
        source_event: event,
      })
    }
    for (const event of effects.filter((candidate) => candidate.kind === 'StanceChanged'))
      append_to(turn, 'status', 0, {
        target_id: fighter_id_from(event, 'fighter', resolve_fighter_id),
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

  for (let cursor = 0; cursor < decoded_events.length; cursor += 1) {
    const event = decoded_events[cursor]
    // A trap Hit already narrated by the walk that sprang it (see the Moved/MobMoved branch) — its beats are
    // written at the step it fired on, so re-rendering it here would double the floater.
    if (claimed_hits.has(event.event_index)) continue
    if (PENDING_WINDOW_KINDS.has(event.kind)) {
      // These BUFFER into `pending` (below) rather than trip the else-branch's premature `flush_pending()` — the
      // #290 fix. write_receipt_effects renders only Displaced/Hit/Drain/StanceChanged; the action envelope +
      // Revealed/CriticalFailure carry no beat and are inert once flushed. See PENDING_WINDOW_KINDS for the why.
      pending.push(event)
      continue
    }

    if (event.kind === 'Cast') {
      const source_id = fighter_id_from(event, 'caster', resolve_fighter_id)
      const turn = ensure_turn(source_id, false, {
        is_mob: !!event.caster_is_mob,
        idx: Number(event.caster_idx),
      })
      // The frozen Cast omits identity; its immediately-following envelope close names the SpellTemplate object.
      const resolved = decoded_events[cursor + 1]
      const same_cast =
        resolved?.kind === 'ActionResolved' &&
        !!resolved.caster_is_mob === !!event.caster_is_mob &&
        Number(resolved.caster_idx) === Number(event.caster_idx) &&
        Number(resolved.target_cell) === Number(event.target_cell)
      const cast = resolve_cast?.(event, same_cast ? resolved : null) ?? {}
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
      continue
    }

    if (event.kind === 'Moved' || event.kind === 'MobMoved') {
      const role = event.kind === 'Moved' ? 'mover' : 'mob'
      const source_id = fighter_id_from(event, role, resolve_fighter_id)
      const to = decoded_cell(event.to_cell, grid_width)
      const cells_lookup = () =>
        typeof fighter_cells === 'function'
          ? fighter_cells(source_id, event)
          : (fighter_cells?.get?.(source_id) ?? fighter_cells?.[source_id] ?? null)
      // ── THE DESTINATION-ONLY ROW (#954/#1050) ──────────────────────────────────────────────────────────────
      // A receipt collapses a whole walk into its LANDED cell, so a trap crossed MID-PATH has no row of its own.
      // The chain fires it INLINE inside `movement::walk` and emits this row only AFTER the walk returns
      // (actions.move:69 / turns.move:305), so its `Hit` arrives BEFORE this row and would flush into a bare
      // `fight` turn at at:0 — read on screen as "the mob took the damage at turn start, before it moved".
      // Claim those Hits BEFORE the flush can orphan them; the walk below splits at the trap cell.
      const mover_hit = (candidate) =>
        candidate.kind === 'Hit' && fighter_id_from(candidate, 'victim', resolve_fighter_id) === source_id
      const pushed_to = [...pending]
        .reverse()
        .find((c) => c.kind === 'Displaced' && fighter_id_from(c, 'target', resolve_fighter_id) === source_id)
      const probe_from = pushed_to
        ? decoded_cell(pushed_to.to_cell, grid_width)
        : (settled_cells.get(source_id) ?? cells_lookup())
      const held = crosses_trap(event, source_id, probe_from, to, cursor) ? pending.filter(mover_hit) : []
      pending = pending.filter((candidate) => !held.includes(candidate))
      flush_pending()
      const turn = ensure_turn(
        source_id,
        false,
        event.kind === 'Moved' ? { character: event.character } : { is_mob: true, idx: Number(event.idx) }
      )
      const known_from = settled_cells.get(source_id) ?? cells_lookup()
      const rendered_path = path_for(event, source_id, known_from, to)
      if (!dead_fighters.has(source_id)) settled_cells.set(source_id, to)
      // Every trap cell the walk ENTERS, in path order — the chain fires each one and resumes (movement.move:43).
      // The endpoint is simply the last step, so the case the renderer used to special-case falls out of this.
      const trap_steps = rendered_path.flatMap((cell, index) => {
        const encoded = encoded_cell(cell, grid_width)
        const trap = matching_trap(encoded, cursor, true)
        const triggered =
          available_traps.length > 0 ? trap : matches_trap(cell, encoded, event) && armed_before(encoded, cursor)
        return triggered ? [{ index, trap }] : []
      })
      // The claim above ran on the pre-flush route; if the post-flush one disagrees (a pending Displaced moved a
      // body the walk had to route around), give the held Hits back rather than swallow them — a dropped floater
      // is a worse bug than the one this fixes.
      if (trap_steps.length === 0 && held.length > 0) write_receipt_effects(turn, held)
      // The SIM emitter returns the move event first (reduce.js `handle_move`), so the same Hits sit AFTER this
      // row instead of before it. Claim them here too: both emitter orders must render identically, which is
      // exactly what lets sim_chain_events align to the chain's order without the simulator inheriting the
      // symptom above (an earlier lane reverted that alignment for want of this).
      const trap_hits = [...held]
      if (trap_steps.length > 0)
        for (let ahead = cursor + 1; ahead < decoded_events.length; ahead += 1) {
          const candidate = decoded_events[ahead]
          // A fresh action's envelope closes the walk's window: its Hits belong to the cast, not to the trap.
          if (!PENDING_WINDOW_KINDS.has(candidate.kind) || candidate.kind === 'ActionStarted') break
          if (!mover_hit(candidate)) continue
          trap_hits.push(candidate)
          claimed_hits.add(candidate.event_index)
        }
      // The gait belongs to the WHOLE walk, never to a leg — splitting a run-length path must not silently drop
      // the mover to a walking cadence on both halves.
      const cell_ms = move_cell_ms(rendered_path.length)
      const write_leg = (leg, landing) => {
        append_to(turn, 'move', Math.max(1, leg.length) * cell_ms, {
          fight_id: event.fight,
          entity_id: source_id,
          path: leg,
          mp_spent: move_mp_spent(leg), // green MP-spent floater (§ move beat carries no chain cost)
          source_event: event,
        })
        append_to(turn, 'arrival', 0, { entity_id: source_id, cell: landing, source_event: event })
      }
      let walked = 0
      for (const [ordinal, trigger] of trap_steps.entries()) {
        const { index: step, trap } = trigger
        const leg = rendered_path.slice(walked, step + 1)
        const cell = rendered_path[step]
        const encoded = encoded_cell(cell, grid_width)
        // The LAST trap absorbs any surplus Hits — a payload may fold several rows (damage + a collision).
        const hits =
          ordinal === trap_steps.length - 1 ? trap_hits.slice(ordinal) : trap_hits.slice(ordinal, ordinal + 1)
        const trap_owner_id = resolve_trap_owner?.(cell, encoded, event) ?? null
        write_leg(leg, cell)
        append_to(turn, 'trap_trigger', TRAP_BEAT_MS, {
          entity_id: source_id,
          target_id: source_id,
          cell,
          trap_cell: encoded,
          trap_anchor: trap?.anchor ?? null,
          damage: hits.reduce((sum, hit) => sum + damage_of_hit(hit), 0),
          trap_owner_id,
          source_event: hits[0] ?? event,
        })
        write_receipt_effects(
          turn,
          hits,
          hits.map((hit) => ({ event_index: hit.event_index, trap_owner_id }))
        )
        walked = step + 1
        // The chain stops the route when the trigger removes the mover from it (death) — so does the narration.
        if (dead_fighters.has(source_id)) break
      }
      const tail = rendered_path.slice(walked)
      if (tail.length > 0) write_leg(tail, to) // no tail ⇒ the walk ENDED on a trap; its arrival is already written
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
