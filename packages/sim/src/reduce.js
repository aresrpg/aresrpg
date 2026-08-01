// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The reducer spine: reduce(state, command, ctx) -> { state, events }.
//
// This REPLACES the donor's async, callback-driven run_fight_loop (loop.ts) — that file's job (turn
// sequencing + push() event emission + sleep() animation timing) splits cleanly: the *sequencing + events*
// become this pure reducer; the *animation timing + network I/O* become the server's orchestration layer.
// Only the donor's RULES survive (imported from fight_actions/fight_spells/fight_ai); its shape is gone.
//
// PURE: no I/O, no logging, no Date.now, no Math.random (combat entropy is explicit in turn_context/turn_rng).
// Same (state, command, ctx)
// -> byte-identical {state, events} every time. The walkability + LoS + occupancy predicates are rebuilt
// here from the arena terrain AND a fresh occupancy scan — occupancy is NEVER baked into the arena cells.

import {
  find_entity,
  find_entity_at,
  get_current_turn_entity,
  generate_turn_order,
  update_entity,
} from './fight_state.js'
import {
  contest_tackle,
  advance_turn,
  apply_damage,
  check_victory,
  use_ap_reserve,
  process_turn_effects,
  expire_turn_effects,
  is_stunned,
} from './fight_actions.js'
import { process_spell_cast } from './fight_spells.js'
import { check_glyphs, check_traps, decay_glyphs } from './fight_traps.js'
import { ai_choose_turn } from './fight_ai.js'
import { process_delayed_payloads } from './fight_delayed.js'
import { find_path_4dir } from './pathfind.js'

// STALEMATE backstop (#97): #62 removed the round cap on purpose (a PvE fight should end only on a real wipe,
// never a low-cap forfeit), which opened an UNBOUNDED-FIGHT DoS — a ≥100-resistance idler takes 0 damage and
// deals none, so check_victory stays null and the fight (Redis state + the 30s turn-timer) lives forever.
// Backstop without reintroducing a cap: detect this many CONSECUTIVE completed rounds with ZERO net total-HP
// change across ALL fighters and auto-end as a DRAW. Reset on any net change, so a normal fight (which moves
// HP most rounds) never trips it; only a genuinely stuck fight (frozen HP, or a perfectly-offsetting heal/shield
// loop) reaches it. Preserves #62's no-cap intent. NOTE: abandon stays UNCONDITIONAL — the draw never gates it.
export const STALEMATE_ROUNDS = 12

// The `winner` value for a stalemate DRAW: concluded (winner !== -1 so the loop/timers tear down) but with NO
// winning team, so the reward path (gated on check_victory === 0, a real team1 wipe) credits nothing.
export const DRAW = 2

export const SIM_EVENT_TYPE = Object.freeze({
  ABANDONED: 'fight_abandoned',
  AP_RESERVE_USED: 'ap_reserve_used',
  PLACED: 'fight_placed',
  READY: 'fight_ready',
})

/**
 * Total HP across all living-or-dead fighters (both teams). The stalemate baseline — a frozen sum across a
 * whole round means no progress. Integer (sum of integer health). Pure.
 * @param {import('./fight_state.js').FightState} state
 * @returns {number}
 */
const total_health = state =>
  [...state.team0, ...state.team1].reduce((sum, e) => sum + e.health, 0)

/**
 * Reducer context: the spell templates and the carved arena. Both are derivable from state (arena from
 * arena_seed/arena_radius) but are passed in so the caller carves/normalizes ONCE, not every command.
 * @typedef {object} ReduceContext
 * @property {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @property {import('./arena.js').Arena} arena
 * #577: `turn_context` is the public turn-seed clock
 * {world_seed, spawn_id, turn_entropy, turn_ordinal, seat, slot}; when
 * present, a PLAYER cast rolls its damage off it (previewable), mirroring the chain. Absent/mob -> crank roll.
 * #1207: a PLAYER move's tackle escape draws off the SAME clock, so the board's preview and this resolver
 * decide one contest instead of two independent coins.
 * @property {{ world_seed:number|bigint|string, spawn_id:number|bigint|string,
 *   turn_entropy:number|bigint|string, turn_ordinal:number|bigint|string,
 *   seat:number|bigint, slot:number }} [turn_context]
 */

/**
 * Commands (client->server vocabulary, mirroring the legacy wire protocol). `start` and `ai_turn` are server-internal.
 * @typedef {{ type: 'place', entity_id: string, cell: import('./cell.js').Cell }} CmdPlace
 * @typedef {{ type: 'ready', entity_id: string }} CmdReady
 * @typedef {{ type: 'start' }} CmdStart
 * @typedef {{ type: 'move', entity_id: string, path: import('./cell.js').Cell[],
 *   turn_context?: ReduceContext['turn_context'] }} CmdMove
 * @typedef {{ type: 'cast', entity_id: string, spell_id: string, target: import('./cell.js').Cell,
 *   turn_context?: ReduceContext['turn_context'] }} CmdCast
 * @typedef {{ type: 'end_turn', entity_id: string }} CmdEndTurn
 * @typedef {{ type: 'use_ap_reserve', entity_id: string }} CmdUseApReserve
 * @typedef {{ type: 'abandon', entity_id: string }} CmdAbandon
 * @typedef {{ type: 'ai_turn', entity_id: string }} CmdAiTurn
 * @typedef {{ type: 'join', entity: import('./fight_state.js').FightEntity }} CmdJoin
 * @typedef {CmdPlace | CmdReady | CmdStart | CmdMove | CmdCast | CmdEndTurn | CmdUseApReserve | CmdAbandon | CmdAiTurn | CmdJoin} Command
 */

/**
 * An event (server->client). Plain `{ type, ... }` — the sim does NOT import @aresrpg/protocol; the server
 * maps these to proto messages. Names align with proto where it exists; gaps are flagged in the report.
 * @typedef {{ type: string, [key: string]: unknown }} FightEvent
 */

/**
 * The reducer return shape.
 * @typedef {{ state: import('./fight_state.js').FightState, events: FightEvent[] }} ReduceResult
 */

// ── Grid predicates (terrain AND fresh occupancy — kept separate) ───────────────

/**
 * Terrain walkability from the carved arena (0 = walkable, 1 = obstacle/void). Out-of-bounds = blocked.
 * @param {import('./arena.js').Arena} arena
 * @param {import('./cell.js').Cell} cell
 * @returns {boolean}
 */
const terrain_walkable = (arena, cell) => {
  if (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= arena.width ||
    cell.y >= arena.height
  )
    return false
  return arena.cells[cell.y * arena.width + cell.x] === 0
}

/**
 * Build the frozen living-body predicate for one mover. Dead fighters never block; invisible living fighters do.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} mover_id
 * @returns {(cell: import('./cell.js').Cell) => boolean}
 */
const make_is_occupied = (state, mover_id) => cell => {
  const occupant = find_entity_at(state, cell)
  return !!occupant && occupant.id !== mover_id
}

/**
 * Build the targeting context (LoS blocking + occupancy) for a caster. Donor grid-context.ts:24 pattern,
 * rebuilt over live actors. An obstacle OR an interposing OTHER entity blocks LoS.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./arena.js').Arena} arena
 * @param {string} caster_id
 * @returns {import('./spell_targeting.js').TargetingContext}
 */
const make_targeting_context = (state, arena, caster_id) => ({
  blocks_los: cell => {
    if (!terrain_walkable(arena, cell)) return true
    const occupant = find_entity_at(state, cell)
    return !!occupant && occupant.id !== caster_id
  },
  is_occupied: cell => !!find_entity_at(state, cell),
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Append a FightEnded event iff a team just got wiped (and the fight wasn't already over). */
const with_victory = (prev_winner, state, events) => {
  if (prev_winner !== -1) return { state, events }
  const victory = check_victory(state)
  if (victory === null) return { state, events }
  const won_state = { ...state, winner: victory }
  return {
    state: won_state,
    events: [
      ...events,
      { type: 'fight_ended', fight_id: state.fight_id, winner: victory },
    ],
  }
}

/**
 * The LIVING actor whose turn it is, in an ONGOING fight — the gate for every ACTING command (move / cast /
 * use-ap-reserve). c156: a DEAD actor lingers as current_turn_entity until its turn is advanced, and any actor
 * once the fight is decided (winner set) must not act — both return null here so the command is a no-op.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {import('./fight_state.js').FightEntity | null}
 */
const acting_entity = (state, entity_id) => {
  if (state.winner !== -1) return null
  const current = get_current_turn_entity(state)
  if (!current || current.id !== entity_id || current.health <= 0) return null
  return current
}

/**
 * After an ACTING command (move/cast) resolves, if `actor_id` (the actor whose turn it is) just DIED but the
 * fight continues, END its turn NOW — a dead fighter holds no turn (c156: no lingering turn timer / no waiting
 * for the 30s auto-end). Mirrors handle_end_turn's advance (minus the draw): advance to the next actable
 * entity + emit fight_turn_end / fight_turn_start, then re-check victory. A wiped team was
 * already ended by the caller's `with_victory`, so this only fires when the actor's side still has survivors.
 * @param {ReduceResult} result  the already-victory-checked result of the command
 * @param {string} actor_id
 * @returns {ReduceResult}
 */
const advance_if_dead = (result, actor_id) => {
  if (result.state.winner !== -1) return result
  const actor = find_entity(result.state, actor_id)
  if (!actor || actor.health > 0) return result
  const advanced = advance_to_actor(result.state)
  const next = get_current_turn_entity(advanced.state)
  const events = [
    ...result.events,
    {
      type: 'fight_turn_end',
      fight_id: result.state.fight_id,
      entity_id: actor_id,
    },
    ...advanced.events,
    ...(next
      ? [
          {
            type: 'fight_turn_start',
            fight_id: result.state.fight_id,
            entity_id: next.id,
            ap: next.ap,
            mp: next.mp,
          },
        ]
      : []),
  ]
  // THE WINNER THIS ADVANCE STARTED FROM, never the one it ENDED on (#1169). `apply_damage` latches `winner`
  // on the state the instant a kill wipes a team, so a turn-start hazard fired inside `advance_to_actor` can
  // decide the fight silently: reading `advanced.state.winner` back as the "previous" winner made
  // `with_victory` believe the fight was ALREADY over and skip its announcement, so the state was terminal and
  // `fight_ended` was never emitted — no `Victory` row, no client terminal, a fight that runs open-ended. The
  // guard above already proved this winner is -1; naming it (as handle_move/handle_cast/handle_end_turn all do)
  // is what keeps the announcement bound to the decision.
  return with_victory(result.state.winner, advanced.state, events)
}

// ── Command handlers ───────────────────────────────────────────────────────────

/**
 * Placement: drop an entity onto one of its team's spawn cells (must be a legal, unoccupied team cell).
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdPlace} cmd
 * @returns {ReduceResult}
 */
const handle_place = (state, cmd) => {
  if (state.started) return { state, events: [] }
  const entity = find_entity(state, cmd.entity_id)
  if (!entity) return { state, events: [] }
  const team = state.team0.some(e => e.id === cmd.entity_id) ? 0 : 1
  const team_cells = team === 0 ? state.team0_cells : state.team1_cells
  const legal = team_cells.some(c => c.x === cmd.cell.x && c.y === cmd.cell.y)
  if (!legal) return { state, events: [] }
  if (find_entity_at(state, cmd.cell)) return { state, events: [] }
  const placed = update_entity(state, cmd.entity_id, e => ({
    ...e,
    cell: cmd.cell,
  }))
  return {
    state: placed,
    events: [
      {
        type: SIM_EVENT_TYPE.PLACED,
        fight_id: state.fight_id,
        entity_id: cmd.entity_id,
        cell: cmd.cell,
      },
    ],
  }
}

/**
 * JOIN (placement phase only): append a pre-built human FightEntity to team0 (the human team), placed on the
 * first FREE team0 spawn cell. A non-participant who clicked a roam fight MARKER and chose the human team
 * enters here — the server builds `entity` from their on-chain character (like the duel/mob entities) and
 * issues this command to the fight owner. Deterministic + pure: no rng, no clock, no occupied/illegal cell.
 * Rejected once started (joins are only allowed in the placement window) or if the team is full / arena has no
 * free spawn cell or the id is already a fighter. Emits `fight_joined` so the server re-broadcasts the
 * refreshed FightSpawn (the new fighter appears on every participant's board).
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdJoin} cmd
 * @returns {ReduceResult}
 */
const handle_join = (state, cmd) => {
  if (state.started) return { state, events: [] }
  const { entity } = cmd
  // never re-add an existing fighter (idempotent against a double-click / re-delivery)
  if (find_entity(state, entity.id)) return { state, events: [] }
  // first team0 spawn cell not already occupied by a placed fighter
  const free = state.team0_cells.find(c => !find_entity_at(state, c))
  if (!free) return { state, events: [] }
  const placed = { ...entity, cell: free }
  const joined = { ...state, team0: [...state.team0, placed] }
  return {
    state: joined,
    events: [
      {
        type: 'fight_joined',
        fight_id: state.fight_id,
        entity_id: placed.id,
        team: 0,
        cell: free,
      },
    ],
  }
}

/**
 * READY (placement phase): mark a real player-fighter ready. When EVERY is_player on BOTH teams is ready,
 * force-start combat internally and append handle_start's events (the all-ready early start; the server's
 * 60s placement timer is the fallback). Mobs are auto-ready (never block the start). Ignored once started.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdReady} cmd
 * @returns {ReduceResult}
 */
const handle_ready = (state, cmd) => {
  if (state.started) return { state, events: [] }
  const entity = find_entity(state, cmd.entity_id)
  if (!entity || !entity.is_player) return { state, events: [] }
  if (state.ready.includes(cmd.entity_id)) return { state, events: [] }

  const marked = { ...state, ready: [...state.ready, cmd.entity_id] }
  /** @type {ReduceResult} */
  const ready_result = {
    state: marked,
    events: [
      {
        type: SIM_EVENT_TYPE.READY,
        fight_id: state.fight_id,
        entity_id: cmd.entity_id,
      },
    ],
  }
  // Every PLAYER on both teams ready -> force-start now (mobs never gate the start).
  const all_players_ready = [...marked.team0, ...marked.team1]
    .filter(e => e.is_player)
    .every(e => marked.ready.includes(e.id))
  if (!all_players_ready) return ready_result

  const started = handle_start(marked)
  return {
    state: started.state,
    events: [...ready_result.events, ...started.events],
  }
}

/**
 * Start combat: compute the fixed turn order, flip `started`, and reset the first actor's resources.
 * Donor loop.ts:112 + types.ts:157. Nothing is dealt — a fighter's castable set is its whole spell book
 * (`spell_levels`) from the first turn to the last, exactly as on chain.
 * @param {import('./fight_state.js').FightState} state
 * @returns {ReduceResult}
 */
const handle_start = state => {
  if (state.started) return { state, events: [] }
  const turn_order = generate_turn_order(state.team0, state.team1)
  const started = {
    ...state,
    turn_order,
    current_turn_idx: 0,
    turn_number: 1,
    started: true,
    // Seed the stalemate baseline at the true fight start (after any placement-phase joins changed the roster).
    no_progress_rounds: 0,
    last_total_hp: total_health(state),
  }
  const first = get_current_turn_entity(started)
  return {
    state: started,
    events: [
      {
        type: 'fight_started',
        fight_id: state.fight_id,
        turn_order,
        seed: state.arena_seed,
      },
      ...(first
        ? [
            {
              type: 'fight_turn_start',
              fight_id: state.fight_id,
              entity_id: first.id,
              // The actor's AUTHORITATIVE pools at turn start (refilled to max by advance_turn / fresh at
              // start). The client SETS these verbatim rather than guessing ap_max, so a reconnect that
              // re-emits a turn_start for a mid-turn actor resumes at the real spent pools (no free re-act).
              ap: first.ap,
              mp: first.mp,
            },
          ]
        : []),
    ],
  }
}

/**
 * Move to the submitted path's destination; the canonical path is rebuilt here exactly as Move does.
 * Donor loop.ts:244 + actions.ts:92.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdMove} cmd
 * @param {ReduceContext} ctx
 * @returns {ReduceResult}
 */
const handle_move = (state, cmd, ctx) => {
  const current = acting_entity(state, cmd.entity_id)
  if (!current) return { state, events: [] }

  // Move's public door is destination-only. Keep the legacy command shape, but treat only its final cell as input
  // and rebuild the route over one frozen terrain+living-body mask. A same-cell/absent/blocked/over-budget target
  // is illegal; caller intermediates never choose trap cells or an equal-cost detour for the deterministic twin.
  const destination = cmd.path.at(-1)
  if (!destination) return { state, events: [] }
  const is_walkable = cell => terrain_walkable(ctx.arena, cell)
  const is_occupied = make_is_occupied(state, cmd.entity_id)
  const canonical = find_path_4dir(
    current.cell,
    destination,
    current.mp,
    is_walkable,
    is_occupied,
  )
  if (!canonical || canonical.length < 2) return { state, events: [] }
  const canonical_cmd = { ...cmd, path: canonical.slice(1) }

  const walked = walk_path(state, canonical_cmd, ctx)
  const moved = find_entity(walked.state, cmd.entity_id)
  const moved_event = {
    type: 'fight_moved',
    fight_id: state.fight_id,
    entity_id: cmd.entity_id,
    path: walked.tackled ? [moved?.cell ?? current.cell] : walked.traversed,
    tackled: walked.tackled,
    mp_remaining: moved?.mp ?? 0,
  }
  if (walked.tackled) return { state: walked.state, events: [moved_event] }
  const won = with_victory(state.winner, walked.state, [
    moved_event,
    ...walked.events,
  ])
  // If the mover died on a trap but the fight continues, its turn ends now (c156: no dead-actor turn).
  return advance_if_dead(won, cmd.entity_id)
}

/**
 * Walk the canonical path one cell at a time so a covered trap fires the INSTANT the mover ENTERS its cell and
 * the route RESUMES afterward (#325). Tackle contests once at the start cell (apply_move parity); each entered
 * trap resolves through the shared check_traps door — owner/ally-blind, every entry kind triggers (#320) — as an
 * INTERLEAVED effect, never a turn-terminal one. The walk stops early ONLY when the trigger removes the mover
 * from the route: it DIED, or a payload (a repulsive trap) displaced it off the cell it just entered. Every
 * crossed trap fires, in path order (a path may cross more than one).
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdMove} cmd
 * @param {ReduceContext} ctx
 * @returns {{ state: import('./fight_state.js').FightState, traversed: import('./cell.js').Cell[], events: FightEvent[], tackled: boolean }}
 */
const walk_path = (state, cmd, ctx) => {
  const terrain = cell => terrain_walkable(ctx.arena, cell)
  // #1207 — the same precedence handle_cast uses: a recorded capsule carries the exact public clock the live
  // fold ran with, so a replayed move re-rolls the identical escape.
  const contest = contest_tackle(
    state,
    cmd.entity_id,
    cmd.turn_context ?? ctx.turn_context ?? null,
  )
  if (!contest.escaped)
    return { state: contest.state, traversed: [], events: [], tackled: true }
  const walked = cmd.path.reduce(
    (acc, target) => {
      if (acc.stop) return acc
      // Enter the next cell (relocate + spend 1 MP), then resolve any trap covering it from the authoritative
      // entered cell — displacement in the payload therefore originates from the true stop, exactly as before.
      const relocated = update_entity(acc.state, cmd.entity_id, e => ({
        ...e,
        cell: target,
        mp: Math.max(0, e.mp - 1),
        mp_used: e.mp_used + 1,
      }))
      const trap = check_traps(relocated, target, cmd.entity_id, terrain)
      const after = find_entity(trap.state, cmd.entity_id)
      const off_route =
        !!after && (after.cell.x !== target.x || after.cell.y !== target.y)
      return {
        state: trap.state,
        traversed: [...acc.traversed, target],
        events: trap.triggered
          ? [
              ...acc.events,
              {
                type: 'fight_trap_triggered',
                fight_id: state.fight_id,
                entity_id: cmd.entity_id,
                cell: target,
                effects: trap.effects,
              },
            ]
          : acc.events,
        stop: !after || after.health <= 0 || off_route,
      }
    },
    { state: contest.state, traversed: [], events: [], stop: false },
  )
  return {
    state: walked.state,
    traversed: walked.traversed,
    events: walked.events,
    tackled: false,
  }
}

/**
 * Cast a spell. The gates are the chain's and only the chain's — the template must exist, and
 * `process_spell_cast` applies AP, range, LoS, casts_per_turn, casts_per_target and cooldown
 * (cast.move:130-192). No hand, no discard: every spell a fighter knows is castable every turn its
 * authored limits allow (#1012). Donor loop.ts:281 + spells.ts:40.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdCast} cmd
 * @param {ReduceContext} ctx
 * @returns {ReduceResult}
 */
const handle_cast = (state, cmd, ctx) => {
  const current = acting_entity(state, cmd.entity_id)
  if (!current) return { state, events: [] }
  const spell = ctx.spell_templates.get(cmd.spell_id)
  if (!spell) return { state, events: [] }
  const level = current.spell_levels[cmd.spell_id] ?? 1
  const context = make_targeting_context(state, ctx.arena, cmd.entity_id)
  // Terrain-only walkability for PUSH/PULL collisions (a push into a wall stops + deals collision damage).
  const is_terrain_walkable = cell => terrain_walkable(ctx.arena, cell)

  const res = process_spell_cast(
    state,
    cmd.entity_id,
    spell,
    level,
    cmd.target,
    context,
    is_terrain_walkable,
    cmd.turn_context ?? ctx.turn_context ?? null, // recorded capsules carry the exact public clock used live
  )
  if (!res.success) return { state, events: [] }

  const events = [
    {
      type: 'fight_cast',
      fight_id: state.fight_id,
      entity_id: cmd.entity_id,
      spell_id: cmd.spell_id,
      target: cmd.target,
      effects: res.effects,
      is_critical: res.is_critical,
      ap_remaining: res.caster_ap_remaining,
    },
  ]
  // If the caster died to its own AoE (it stood in the blast) but the fight continues, end its turn now.
  return advance_if_dead(
    with_victory(state.winner, res.state, events),
    cmd.entity_id,
  )
}

/**
 * End the current actor's turn: advance the turn (skipping the dead), emit start/end.
 * Donor loop.ts:346 + actions.ts:329.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdEndTurn} cmd
 * @returns {ReduceResult}
 */
const handle_end_turn = (state, cmd) => {
  const current = get_current_turn_entity(state)
  if (!current || current.id !== cmd.entity_id) return { state, events: [] }

  const advanced = advance_to_actor(state)
  const next = get_current_turn_entity(advanced.state)

  /** @type {import('./reduce.js').FightEvent[]} */
  const events = [
    {
      type: 'fight_turn_end',
      fight_id: state.fight_id,
      entity_id: cmd.entity_id,
    },
    // Turn-start hazards (DoT/glyph floating numbers + stun-skips) collected by advance_to_actor.
    ...advanced.events,
    ...(next
      ? [
          {
            type: 'fight_turn_start',
            fight_id: state.fight_id,
            entity_id: next.id,
            // Authoritative refilled pools (advance_turn set ap=ap_max, mp=mp_max) — client sets verbatim.
            ap: next.ap,
            mp: next.mp,
          },
        ]
      : []),
  ]
  // A turn-start hazard (DoT/glyph) can wipe the last enemy -> end the fight.
  return with_victory(state.winner, advanced.state, events)
}

/**
 * Run the turn-start hazards for the entity whose turn just began: glyphs on its cell, then its TURN_START
 * DoT/HoT effects. Timed rows remain live through the turn and expire in `run_turn_end`, like Move. Returns the
 * number events (`fight_turn_effects`) so the client renders the ticks. Pure (rng-free: DoT values are
 * pre-rolled; glyph damage threads rng inside check_glyphs).
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @returns {{ state: import('./fight_state.js').FightState, events: import('./reduce.js').FightEvent[] }}
 */
const run_turn_start_hazards = (state, entity_id) => {
  const glyphs = check_glyphs(state, entity_id)
  const delayed = process_delayed_payloads(glyphs.state, entity_id)
  const ticks = process_turn_effects(delayed.state, entity_id)
  const all = [...glyphs.effects, ...delayed.effects, ...ticks.effects]
  /** @type {import('./reduce.js').FightEvent[]} */
  const events =
    all.length > 0
      ? [
          {
            type: 'fight_turn_effects',
            fight_id: state.fight_id,
            entity_id,
            effects: all,
          },
        ]
      : []
  return { state: ticks.state, events }
}

/**
 * THE TURN-END CLOCK (#1540 — the chain's cadence, one home). The ending fighter's timed rows decrement first;
 * a glyph's duration additionally ticks on PLAYER turn-ends only:
 * Move's `cast::tick_turn_end` decrements glyphs inside its NON-MOB arm (cast.move:1708, declared at
 * :1691-1692), reached from `turns::forfeit_current` (turns.move:167) — the single door every player turn end
 * goes through. A mob turn-end takes the `is_mob` arm (turns.move:280/:321) and never decrements, and a seat
 * the walk steps over (dead, or killed by its turn-START tick) never reaches a turn end at all. So this is
 * keyed on the ACTOR WHOSE TURN IS ENDING, never on the global turn ordinal — that one advances on mob turns
 * and would price a 3-turn glyph as dead after a single PvM round.
 * @param {import('./fight_state.js').FightState} state  the state BEFORE the turn pointer steps
 * @returns {{ state: import('./fight_state.js').FightState, events: import('./reduce.js').FightEvent[] }}
 */
const run_turn_end = state => {
  const actor = get_current_turn_entity(state)
  if (!actor) return { state, events: [] }
  const expired = expire_turn_effects(state, actor.id)
  const next = actor.is_player ? decay_glyphs(expired.state) : expired.state
  return {
    state: next,
    events:
      expired.effects.length > 0
        ? [
            {
              type: 'fight_turn_effects',
              fight_id: state.fight_id,
              entity_id: actor.id,
              effects: expired.effects,
            },
          ]
        : [],
  }
}

/**
 * Advance the turn to the next ACTABLE entity: step the index, reset AP/MP, run turn-start hazards, and skip
 * any entity that is dead OR stunned (a stunned actor loses its whole turn, then its STUN ages at that skipped
 * turn's end; emit `fight_turn_skipped` so the client shows it). Timed rows and glyph durations tick through
 * `run_turn_end` — never on a stepped-over corpse or an actor killed by its start hazards.
 * Bounded by turn_order length so an all-skipped order can't loop forever. Returns the collected events.
 * @param {import('./fight_state.js').FightState} state
 * @returns {{ state: import('./fight_state.js').FightState, events: import('./reduce.js').FightEvent[] }}
 */
const advance_to_actor = state => {
  // The actor here just ENDED its turn — including a player who self-killed mid-turn, whose own pass still runs
  // the end-phase work on chain (turns.move:181-184, `forfeit_current` tolerates a dead current seat).
  const { state: ended_state, events: ended_events } = run_turn_end(state)
  /** @type {import('./reduce.js').FightEvent[]} */
  let events = ended_events
  let next = advance_turn(ended_state)
  for (let i = 0; i <= next.turn_order.length; i++) {
    const entity = get_current_turn_entity(next)
    if (!entity) break
    // Dead -> step over (no hazards; it has no turn, so no turn-END either: `resolve_from` skips the seat
    // outright, turns.move:213-216 — nothing of its would-be turn ticks).
    if (entity.health <= 0) {
      next = advance_turn(next)
      continue
    }
    // Was this actor stunned at the START of its turn? It remains live through start work and expires at the
    // skipped turn's END, matching Move's split start/end arms.
    const stunned = is_stunned(next, entity.id)
    const hazards = run_turn_start_hazards(next, entity.id)
    next = hazards.state
    events = [...events, ...hazards.events]
    const after = get_current_turn_entity(next)
    // Died to its own DoT/glyph -> step over to the next actor. Its turn never ENDED (Move: `tick_turn_start`
    // returned false and the walk moves on WITHOUT `tick_turn_end` — turns.move:237-246), so nothing ticks.
    if (!after || after.health <= 0) {
      next = advance_turn(next)
      continue
    }
    // Stunned -> turn is skipped; announce, run its real turn-end expiry, then step over. The turn DID begin
    // (its start hazards just ran), so a stunned PLAYER still spends one glyph turn; a stunned mob still spends none.
    if (stunned) {
      events = [
        ...events,
        {
          type: 'fight_turn_skipped',
          fight_id: state.fight_id,
          entity_id: entity.id,
        },
      ]
      const skipped_end = run_turn_end(next)
      events = [...events, ...skipped_end.events]
      next = advance_turn(skipped_end.state)
      continue
    }
    break
  }
  // Stalemate backstop (#97): if this advance COMPLETED a round (turn_number rose) and the fight is still live,
  // recompute the total HP. A sum unchanged from the last round boundary => a no-progress round (idle, or a
  // net-zero heal/shield loop); trip the DRAW at STALEMATE_ROUNDS. Any net change resets the streak. A death
  // this round changes the sum (so the counter resets), which is also why this can never collide with a real
  // wipe. Deterministic: integer sum + integer counter, no clock/rng/float.
  if (next.turn_number > state.turn_number && next.winner === -1) {
    const total = total_health(next)
    const no_progress =
      total === next.last_total_hp ? next.no_progress_rounds + 1 : 0
    next = { ...next, last_total_hp: total, no_progress_rounds: no_progress }
    if (no_progress >= STALEMATE_ROUNDS) {
      next = { ...next, winner: DRAW }
      events = [
        ...events,
        { type: 'fight_ended', fight_id: next.fight_id, winner: DRAW },
      ]
    }
  }
  return { state: next, events }
}

/**
 * Plan + execute a mob's whole turn through the reducer's own move/cast handlers, then end the turn.
 * Keeps mob turns inside the deterministic reducer (the server just sends `ai_turn`). Donor loop.ts:169.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdAiTurn} cmd
 * @param {ReduceContext} ctx
 * @returns {ReduceResult}
 */
const handle_ai_turn = (state, cmd, ctx) => {
  const current = get_current_turn_entity(state)
  if (!current || current.id !== cmd.entity_id) return { state, events: [] }

  const is_walkable = cell => terrain_walkable(ctx.arena, cell)
  const is_occupied = make_is_occupied(state, cmd.entity_id)
  const context = make_targeting_context(state, ctx.arena, cmd.entity_id)
  const plan = ai_choose_turn(
    state,
    cmd.entity_id,
    ctx.spell_templates,
    is_walkable,
    is_occupied,
    context,
  )

  // Execute each planned action through the real handlers (threading state + events), stop on victory.
  let acc = {
    state,
    events: /** @type {import('./reduce.js').FightEvent[]} */ ([]),
  }
  for (const action of plan) {
    if (acc.state.winner !== -1) break
    if (action.type === 'move') {
      const r = handle_move(
        acc.state,
        {
          type: 'move',
          entity_id: cmd.entity_id,
          path: drop_start(action.path),
        },
        ctx,
      )
      acc = { state: r.state, events: [...acc.events, ...r.events] }
    } else if (action.type === 'cast') {
      const r = handle_cast(
        acc.state,
        {
          type: 'cast',
          entity_id: cmd.entity_id,
          spell_id: action.spell_id,
          target: action.target,
        },
        ctx,
      )
      acc = { state: r.state, events: [...acc.events, ...r.events] }
    }
  }

  if (acc.state.winner !== -1) return acc

  const ended = handle_end_turn(acc.state, {
    type: 'end_turn',
    entity_id: cmd.entity_id,
  })
  return { state: ended.state, events: [...acc.events, ...ended.events] }
}

/** The AI returns paths inclusive of the start cell (find_path_4dir output); handle_move wants it excluded. */
const drop_start = path => (path.length > 0 ? path.slice(1) : path)

/**
 * Abandon (forfeit): the seat takes lethal damage, then the fight re-checks terminal. The twin of
 * `packages/move/engine/sources/actions.move` `begin_abandon` + `mark_abandoned` — same two gates, same
 * single death write, same announcement:
 *   • `begin_abandon` asserts the fight is placement|active, so a TERMINAL fight aborts `EFightOver` (105) —
 *     here the winner latch (`state.winner !== -1`) refuses instead, so a decided fight is never re-decided.
 *   • `begin_abandon` resolves `fight::seat_of(fight, character_id)` and aborts `ENotParticipant` when the
 *     character holds no SEAT. A chain seat is a player character, on EITHER side (PvP participants span both
 *     teams — `abandon_in_placement` hands a walkover to the other one), so `is_player` is that predicate:
 *     a mob and a mid-fight SUMMON (fight_summon.js `is_player: false`) have no seat and cannot forfeit.
 *   • `begin_abandon` asserts the seat `is_alive`, so a corpse aborts `EAlreadyDead` (106) — here the same
 *     refusal, so the event stream never doubles a death.
 * A chain ABORT is a refusal; the reducer's refusal is DATA (the input state back, no events) — never a throw.
 * The kill goes through `apply_damage`, the SAME write a killing hit uses (mirroring `mark_abandoned`'s
 * `participant::apply_damage(p, hp)` — no parallel death path), and `fight_abandoned` names the cause with the
 * ordinary damage effect row, the twin of `fight_events::emit_abandoned`.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdAbandon} cmd
 * @returns {ReduceResult}
 */
const handle_abandon = (state, cmd) => {
  // Chain gate order (begin_abandon): status, then seat_of, then is_alive.
  if (state.winner !== -1) return { state, events: [] }
  const entity = find_entity(state, cmd.entity_id)
  if (!entity || !entity.is_player) return { state, events: [] }
  if (entity.health <= 0) return { state, events: [] }

  const hit = apply_damage(state, cmd.entity_id, entity.health)
  return with_victory(state.winner, hit.state, [
    {
      type: SIM_EVENT_TYPE.ABANDONED,
      fight_id: state.fight_id,
      entity_id: cmd.entity_id,
      effects: [
        {
          target_id: cmd.entity_id,
          damage: hit.damage_dealt,
          new_health: 0,
          killed: true,
        },
      ],
    },
  ])
}

/**
 * Use AP reserve. Donor actions.ts:485 + loop.ts:323.
 * @param {import('./fight_state.js').FightState} state
 * @param {CmdUseApReserve} cmd
 * @returns {ReduceResult}
 */
const handle_use_ap_reserve = (state, cmd) => {
  const current = acting_entity(state, cmd.entity_id)
  if (!current) return { state, events: [] }
  if (current.ap_reserve <= 0) return { state, events: [] }
  const added = current.ap_reserve
  const after = use_ap_reserve(state, cmd.entity_id)
  const updated = find_entity(after, cmd.entity_id)
  return {
    state: after,
    events: [
      {
        type: SIM_EVENT_TYPE.AP_RESERVE_USED,
        fight_id: state.fight_id,
        entity_id: cmd.entity_id,
        ap_added: added,
        new_ap: updated?.ap ?? 0,
      },
    ],
  }
}

/**
 * THE REDUCER. Pure: same (state, command, ctx) -> identical {state, events}. The single entry point the
 * server (authority) and client (prediction) both call.
 * @param {import('./fight_state.js').FightState} state
 * @param {Command} command
 * @param {ReduceContext} ctx
 * @returns {ReduceResult}
 */
export const reduce = (state, command, ctx) => {
  switch (command.type) {
    case 'place':
      return handle_place(state, command)
    case 'join':
      return handle_join(state, command)
    case 'ready':
      return handle_ready(state, command)
    case 'start':
      return handle_start(state)
    case 'move':
      return handle_move(state, command, ctx)
    case 'cast':
      return handle_cast(state, command, ctx)
    case 'end_turn':
      return handle_end_turn(state, command)
    case 'use_ap_reserve':
      return handle_use_ap_reserve(state, command)
    case 'abandon':
      return handle_abandon(state, command)
    case 'ai_turn':
      return handle_ai_turn(state, command, ctx)
    default:
      return { state, events: [] }
  }
}

/**
 * Build an initial placement-phase FightState from a carved arena + pre-built entities. A convenience the
 * caller (server) uses to construct state; the legacy rng, explicit turn_rng, and next_id are seeded from
 * `arena_seed` (the determinism root that ALSO seeds carve_world_arena, so the client replays the identical
 * fight from FightStarted.seed).
 * @param {object} params
 * @param {string} params.fight_id
 * @param {number} params.arena_seed
 * @param {number} params.arena_radius
 * @param {import('./arena.js').Arena} params.arena
 * @param {import('./fight_state.js').FightEntity[]} params.team0
 * @param {import('./fight_state.js').FightEntity[]} params.team1
 * @returns {import('./fight_state.js').FightState}
 */
export const create_fight_state = ({
  fight_id,
  arena_seed,
  arena_radius,
  arena,
  team0,
  team1,
}) => ({
  fight_id,
  arena_seed,
  arena_radius,
  started: false,
  ready: [],
  rng: arena_seed >>> 0,
  turn_rng: arena_seed >>> 0,
  next_id: 1,
  team0,
  team1,
  turn_order: [],
  current_turn_idx: 0,
  turn_number: 0,
  traps: [],
  glyphs: [],
  // Per-caster cast history (cooldown / casts_per_turn / casts_per_target) — the client mirror of Move's
  // dynamic fields on the Fight UID (cast.move:45). Empty until a limited spell is cast; keyed off turn_number.
  cast_history: {},
  target_history: {},
  team0_cells: arena.spawns_a,
  team1_cells: arena.spawns_b,
  winner: -1,
  // Stalemate counter (#97); the baseline is re-seeded at the true start by handle_start.
  no_progress_rounds: 0,
  last_total_hp: 0,
})
