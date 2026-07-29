// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/sim_chain.js — THE LOCAL MOCK CHAIN (simulator rebuild spec §4).
//
// The simulator inverts production: `@aresrpg/sim` is the AUTHORITY and the "chain" is a pure local encoder.
// This module is that chain. It owns three jobs and no fight logic whatsoever:
//   1. BOARD    — (u32 seed) → the `board_gen` board (the chain's own derivation) → the sim `Arena`.
//   2. SNAPSHOT — a started sim FightState → the decoded-`Fight` shape the core's snapshot door adopts
//                 (`board_state_from_fight` input; oracle: world-shell/fight_board_simdrive.test.js and
//                 game/dev/dev_synth_fight.js).
//   3. DRIVE    — fold commands through `reduce`, tap the recorder, and hand back ONE receipt batch of
//                 `fight_events` rows the core's ONE door consumes (`sim_chain_events.js` writes the rows;
//                 its whole surface is re-exported here, so consumers only ever import THIS module).
//
// THE CONTRACT (spec §4.4, "one observable, two folders" — v2/fold.js header): folding the emitted rows through
// `apply_action` MUST reproduce the sim's own observable projection (cell / hp / alive / active / winner) at
// every batch boundary. `sim_chain.test.js` is that gate; nothing here is trustworthy without it.
//
// PURE + TOTAL: no `Date.now`, no `Math.random`, no I/O. The ONE u32 seed roots the board, the anchor and
// `state.rng`; wall-clock deadlines are INJECTED by the caller (`now_ms`) because they are UX, never
// determinism — replay rides the sim capsule's command list (spec §10, divergence 2).

import { WORLD_SEED } from '@aresrpg/sim/world'
import { mix, rng_int, rng_seed } from '@aresrpg/sim/prng'
import { board_seed_from_anchor, generate } from '@aresrpg/sim/board_gen'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'
import { effective_stats } from '@aresrpg/sim/fight_state'
import { create_recorder, dump_capsule, observe_reduce_checked, open_recording } from '@aresrpg/sim/recorder'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { decode, encode } from './los.js'
import { DEFAULT_TURN_MS, encode_sim_step, side_of, status_rows_from_sim } from './sim_chain_events.js'
import { casts_this_turn_from_events } from './turn_action_slot.js'

export * from './sim_chain_events.js'

/** Every simulator seat is owned by this one address, so `fight_control.controlled_character_ids` returns the
 *  WHOLE roster and the production seat-focus switching drives multi-account play with zero new mechanism. */
export const LOCAL_ADDRESS = '0x51m0000000000000000000000000000000000000000000000000000000000000'

/** Board-shape mask bit test — the `combat_grid.move` u64 BITSET layout (word `cell>>6`, bit `cell & 63`). */
const mask_has = (mask, cell) => {
  const word = mask?.[Math.floor(cell / 64)]
  return word == null ? false : ((BigInt(word) >> BigInt(cell % 64)) & 1n) === 1n
}

/** Anchor spread (cells) the seed-derived board anchor is drawn from, centered on the world origin. */
const ANCHOR_SPAN = 4096

/** The anchor the ONE seed draws when the page has not rerolled it independently (spec §9 flow 4). Pure. */
export const anchor_from_seed = (seed) => {
  const draw_x = rng_int(rng_seed(seed), ANCHOR_SPAN)
  const draw_z = rng_int(draw_x.state, ANCHOR_SPAN)
  return { anchor_x: draw_x.value - ANCHOR_SPAN / 2, anchor_z: draw_z.value - ANCHOR_SPAN / 2 }
}

/**
 * Derive this fight's board from the ONE u32 seed (or an independently rerolled anchor) through the EXACT
 * chain derivation — `board_seed_from_anchor` → `generate`, the `board.move` twin. Pure: same inputs, same
 * board, forever.
 * @param {number} seed
 * @param {{ anchor_x?: number, anchor_z?: number }} [anchor]
 * @returns {{ seed:number, anchor_x:number, anchor_z:number, board_seed:number, board: ReturnType<typeof generate> }}
 */
export const derive_board = (seed, anchor = {}) => {
  const seeded = anchor_from_seed(seed)
  const anchor_x = anchor.anchor_x ?? seeded.anchor_x
  const anchor_z = anchor.anchor_z ?? seeded.anchor_z
  const board_seed = board_seed_from_anchor(WORLD_SEED, anchor_x, anchor_z)
  return { seed: seed >>> 0, anchor_x, anchor_z, board_seed, board: generate(board_seed, 0) }
}

/**
 * The sim `Arena` derived from a generated board: a cell is BLOCKED (1) when it is off-mask, an obstacle or a
 * hole. Spawn sets decode the board's stride-20 start cells (`los.decode`) — the sim works in `{x,y}`, the
 * chain in `y*20+x`, and this is the ONE place the two meet.
 * @param {ReturnType<typeof generate>} board
 * @returns {{ width:number, height:number, radius:number, center:{x:number,y:number}, cells:Uint8Array,
 *   spawns_a:{x:number,y:number}[], spawns_b:{x:number,y:number}[] }}
 */
export const arena_from_board = (board) => {
  const { width, height } = board
  const blocked = new Set([...board.obstacles, ...board.holes])
  const cells = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cell = encode(x, y)
      cells[y * width + x] = mask_has(board.shape_mask, cell) && !blocked.has(cell) ? 0 : 1
    }
  return {
    width,
    height,
    radius: width >> 1,
    center: { x: width >> 1, y: height >> 1 },
    cells,
    spawns_a: board.start_cells_a.map(decode),
    spawns_b: board.start_cells_b.map(decode),
  }
}

// ╔════════════════ [ The snapshot — a started sim state → the decoded-Fight shape ] ═══════════════════════ ]

const ENGINE_STATUS_ACTIVE = 1

/** A plain `{ key: value }` map → the chain's `VecMap` json shape, so the core's ONE decoder reads the mock and
 *  the real read the same way (this module is an encoder into the chain's dialect, never a second shape). */
const vec_map = (entries) => ({
  contents: Object.entries(entries ?? {}).map(([key, value]) => ({ key, value })),
})

/**
 * Build the decoded-`Fight` the core's snapshot door adopts. Field set + naming follow the two existing
 * hand-builders verbatim (fight_board_simdrive.test.js `decoded_fight`, dev_synth_fight.js `decoded_fight`) —
 * raw `participant.move` / `mob.move` names, cells in canonical stride-20.
 * @param {object} chain
 * @param {{ now_ms?: number, turn_ms?: number }} [clock]
 */
export const snapshot_from_sim = (chain, { now_ms = 0, turn_ms = DEFAULT_TURN_MS } = {}) => {
  const { sim_state, board, anchor_x, anchor_z, fight_id, seed } = chain
  const events = (chain.recorder?.entries ?? []).flatMap((entry) => (entry.kind === 'step' ? entry.events : []))
  return {
    id: fight_id,
    status: ENGINE_STATUS_ACTIVE,
    width: board.width,
    height: board.height,
    participants: sim_state.team0.map((e) => ({
      owner: LOCAL_ADDRESS,
      character: e.id,
      class: e.template_id ?? '',
      team: 0,
      hp: e.health,
      max_hp: e.health_max,
      ap: e.ap,
      mp: e.mp,
      base_ap: e.ap_max,
      base_mp: e.mp_max,
      cell: encode(e.cell.x, e.cell.y),
      ready: true,
      casts_this_turn: casts_this_turn_from_events({
        events,
        turn_started: (event) => event.type === 'fight_turn_start' && event.entity_id === e.id,
        cast: (event) => event.type === 'fight_cast' && event.entity_id === e.id,
      }),
      weapon: null,
      // THE WHOLE BLOCK, both halves (#1077) — the mock chain speaks `participant.move`'s own dialect, and that
      // struct carries `stats` LIVE (base + the timed alter rows) next to the `base_stats` join snapshot. A
      // one-key `{agility}` row was the client's blindness: every predict surface read an empty stat block and
      // painted base damage for a geared seat. `spell_levels` rides as the chain's VecMap.
      stats: effective_stats(e),
      base_stats: e.stats ?? {},
      spell_levels: vec_map(e.spell_levels),
    })),
    mobs: sim_state.team1.map((e) => ({
      template: e.template_id ?? null,
      level: e.level,
      hp: e.health,
      max_hp: e.health_max,
      cell: encode(e.cell.x, e.cell.y),
      ap: e.ap,
      mp: e.mp,
      stats: effective_stats(e),
      base_stats: e.stats ?? {},
    })),
    group_template: chain.group_template ?? null,
    group_base_ap: sim_state.team1[0]?.ap_max ?? 0,
    group_base_mp: sim_state.team1[0]?.mp_max ?? 0,
    // The chain stores its interleaved queue at activation; the sim computed the SAME order at handle_start
    // (generate_turn_order === interleave.move `order`), so hand it over rather than let the view replicate it.
    queue: sim_state.turn_order.map((id) => side_of(sim_state, id)),
    turn_ptr: sim_state.current_turn_idx,
    turn_ms,
    turn_deadline_ms: now_ms + turn_ms,
    turn_entropy: chain.ctx.turn_context.turn_entropy,
    turn_ordinal: chain.ctx.turn_context.turn_ordinal,
    placement_deadline_ms: 0,
    world_seed: BigInt(WORLD_SEED >>> 0),
    spawn_id: seed,
    obstacles: board.obstacles,
    holes: board.holes,
    shape_mask: board.shape_mask,
    start_cells_a: board.start_cells_a,
    start_cells_b: board.start_cells_b,
    anchor_x,
    anchor_z,
    // The simulator's object read STATES the statuses the sim holds. `[]` is not "we did not look" — the store
    // reads a snapshot's status array as authoritative (board_state.js), so a hardcoded empty set wiped every
    // live invisibility and buff badge on each refresh (#952).
    invisibility_statuses: status_rows_from_sim(sim_state),
  }
}

// ╔════════════════ [ The chain — create · submit · ai turn · capsule ] ═══════════════════════════════════ ]

/**
 * Boot a local chain: derive the board from the seed, build the sim state over the caller's ALREADY-BUILT
 * fight entities (content is `packages/frontend/src/simulator/content.js`'s job — L1), place every fighter,
 * ready the players (which force-starts combat) and open the recorder.
 *
 * `team0` / `team1` are sim `FightEntity` rows whose `cell` is the seat's chosen start cell.
 *
 * TEMPLATES ARE RAW, exactly as the real chain holds them: `templates_raw` are authored `SpellTemplate` rows
 * and the sim's `normalize_spell_templates` is the ONE ingress that turns them into the reducer's map — the
 * same door production runs. That is also what makes the capsule replayable: `replay_capsule` re-normalizes
 * `templates_raw`, and the normalizer is NOT idempotent (its own output re-reads as `UNSUPPORTED`), so a
 * recorder header holding normalized rows would replay every spell inert. Raw in, raw recorded, one home.
 *
 * @param {{ seed: number, fight_id: string, team0: object[], team1: object[],
 *   templates_raw?: object[], anchor?: { anchor_x?: number, anchor_z?: number },
 *   group_template?: string|null, capacity?: number }} params
 */
export const create_sim_chain = ({
  seed,
  fight_id,
  team0,
  team1,
  templates_raw = [],
  anchor = {},
  group_template = null,
  capacity,
}) => {
  const { board, anchor_x, anchor_z } = derive_board(seed, anchor)
  const arena = arena_from_board(board)
  // The mock chain has no framework `&Random`, so it derives a deterministic local entropy carrier from the
  // fight seed and turn ordinal. The shape and seed fold are the production wire's; only the entropy source is
  // simulator-local. `fold_command` refreshes seat/slot/ordinal before every player cast.
  const ctx = {
    spell_templates: normalize_spell_templates(templates_raw),
    arena,
    turn_context: {
      world_seed: BigInt(WORLD_SEED >>> 0),
      spawn_id: seed >>> 0,
      turn_entropy: mix(seed, 0),
      turn_ordinal: 0,
      seat: 0,
      slot: 0,
    },
  }
  const initial = create_fight_state({
    fight_id,
    arena_seed: seed >>> 0,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  // Placement is the caller's cells, replayed through the reducer door so the capsule's command list is
  // COMPLETE — a capsule that starts mid-placement is not replayable.
  const commands = [
    ...[...team0, ...team1].map((e) => ({ type: 'place', entity_id: e.id, cell: e.cell })),
    ...team0.map((e) => ({ type: 'ready', entity_id: e.id })),
  ]
  const opened = {
    seed: seed >>> 0,
    fight_id,
    board,
    anchor_x,
    anchor_z,
    arena,
    ctx,
    group_template,
    sim_state: initial,
    version: 1,
    actions: {},
    recorder: open_recorder({ fight_id, arena, templates_raw, initial, capacity }),
    violations: [],
  }
  return commands.reduce((chain, command) => fold_command(chain, command).chain, opened)
}

/** The recorder ring, opened with the capsule HEADER (arena + raw templates + initial teams) — the exact
 *  `timeline.js Capsule` field set, so a dumped simulator fight replays through the authored-golden door. */
const open_recorder = ({ fight_id, arena, templates_raw, initial, capacity }) =>
  open_recording(create_recorder(capacity), {
    fight_id,
    arena: {
      width: arena.width,
      height: arena.height,
      cells: [...arena.cells],
      spawns_a: arena.spawns_a,
      spawns_b: arena.spawns_b,
    },
    templates_raw,
    initial: { fight_id, arena_seed: initial.arena_seed, team0: initial.team0, team1: initial.team1 },
    meta: { class: 'simulator' },
  })

/** Fold ONE command: reduce, tap the recorder (physics tripwires live), bank the events. Pure. */
const active_turn_context = (
  chain,
  state,
  actions = chain.actions ?? {},
  turn_ordinal = chain.ctx.turn_context.turn_ordinal
) => {
  const order = state.turn_order ?? []
  const entity_id = order[state.current_turn_idx % Math.max(1, order.length)]
  const seat = state.team0.findIndex((entity) => entity.id === entity_id)
  return {
    world_seed: BigInt(WORLD_SEED >>> 0),
    spawn_id: chain.seed,
    turn_entropy: mix(chain.seed, turn_ordinal),
    turn_ordinal,
    // A mob has no player turn-seed seat/slot. The local encoder may surface its TurnStarted with the last
    // player-published entropy/ordinal; zeroes keep this context total and the mob cast arm ignores them.
    seat: Math.max(0, seat),
    slot: seat < 0 ? 0 : Number(actions[`${entity_id}:${state.turn_number ?? 0}`] ?? 0),
  }
}

// A cast AND a move both resolve off the actor's clock at its live slot — the cast for crit/damage, the move
// for its tackle escape (#1207) — so both re-derive it at fold time rather than reusing the carried context,
// whose slot was computed before the previous step's action counter advanced.
const CLOCKED_COMMANDS = new Set(['cast', 'move'])

/** A capsule command must be JSON-safe while preserving every u64-ish clock byte exactly. A player MOVE carries
 *  it too (#1207): its tackle escape draws off the clock, so a replay stripped of it re-rolls a different
 *  contest and decides a different fight. */
const recorded_command = (chain, command, turn_context) => {
  if (!CLOCKED_COMMANDS.has(command.type) || !chain.sim_state.team0.some((entity) => entity.id === command.entity_id))
    return command
  return {
    ...command,
    turn_context: {
      ...turn_context,
      world_seed: String(turn_context.world_seed),
      spawn_id: String(turn_context.spawn_id),
      turn_entropy: String(turn_context.turn_entropy),
      turn_ordinal: String(turn_context.turn_ordinal),
      seat: String(turn_context.seat),
    },
  }
}

const fold_command = (chain, command, actions = chain.actions ?? {}) => {
  const turn_context = CLOCKED_COMMANDS.has(command.type)
    ? active_turn_context(chain, chain.sim_state, actions)
    : chain.ctx.turn_context
  const { state, events } = reduce(chain.sim_state, command, { ...chain.ctx, turn_context })
  // Production stamps fresh entropy only when `turns::resolve_from` lands on a PLAYER; mobs resolve inside the
  // crank wave. Count those landings directly instead of borrowing sim `turn_number`, which counts rounds and
  // therefore cannot distinguish two co-op seats in the same round.
  const player_starts = events.filter(
    (event) => event.type === 'fight_turn_start' && state.team0.some((entity) => entity.id === event.entity_id)
  ).length
  const next_ordinal = Number(chain.ctx.turn_context.turn_ordinal) + player_starts
  const next_ctx = {
    ...chain.ctx,
    turn_context: active_turn_context(chain, state, actions, next_ordinal),
  }
  const tapped = observe_reduce_checked(chain.recorder, {
    fight_id: chain.fight_id,
    command: recorded_command(chain, command, turn_context),
    pre_state: chain.sim_state,
    post_state: state,
    events,
  })
  return {
    chain: {
      ...chain,
      sim_state: state,
      ctx: next_ctx,
      recorder: tapped.rec,
      violations: [...chain.violations, ...tapped.violations],
    },
    pre_state: chain.sim_state,
    events,
  }
}

/**
 * THE SUBMIT DOOR (spec §4.5) — fold a player's whole committed turn and hand back ONE receipt batch. The
 * production optimistic-prediction machinery runs unchanged against it: no PTB, no gas, no digest.
 * @param {object} chain
 * @param {object[]} commands sim commands (`commands_from_staged` builds them from the store's staged draft)
 * @param {{ now_ms?: number, turn_ms?: number }} [clock]
 * @returns {{ chain: object, version: number, receipt: { events: object[] } }}
 */
export const submit_commands = (chain, commands, { now_ms = 0, turn_ms = DEFAULT_TURN_MS } = {}) => {
  const folded = commands.reduce(
    (acc, command) => {
      const step = fold_command(acc.chain, command, acc.actions)
      const encoded = encode_sim_step({
        pre_state: step.pre_state,
        post_state: step.chain.sim_state,
        events: step.events,
        fight_id: acc.chain.fight_id,
        now_ms,
        turn_ms,
        // The action envelope reads the AUTHORED effect descriptors off the templates, and its action ordinal
        // counts the caster's actions THIS TURN — a turn spans several commands, so the counter outlives one
        // step and lives on the chain (the chain's own `casts_this_turn` / `next_mob_action` twin).
        spell_templates: acc.chain.ctx.spell_templates,
        actions: acc.actions,
        turn_context: step.chain.ctx.turn_context,
      })
      return {
        chain: step.chain,
        rows: [...acc.rows, ...encoded.rows],
        actions: encoded.actions,
      }
    },
    { chain, rows: [], actions: chain.actions ?? {} }
  )
  const version = chain.version + 1
  return {
    chain: {
      ...folded.chain,
      version,
      actions: folded.actions,
      ctx: {
        ...folded.chain.ctx,
        turn_context: active_turn_context(folded.chain, folded.chain.sim_state, folded.actions),
      },
    },
    version,
    receipt: { events: folded.rows },
  }
}

/** A mob turn (spec §4.6) — the same door, one `ai_turn` command. */
export const run_ai_turn = (chain, entity_id, clock) => submit_commands(chain, [{ type: 'ai_turn', entity_id }], clock)

/** The sim entity whose turn it is, or null (a concluded fight has none). */
export const current_actor = (chain) => {
  const state = chain.sim_state
  const order = state.turn_order ?? []
  if (state.winner !== -1 || order.length === 0) return null
  return order[state.current_turn_idx % order.length] ?? null
}

/** The mob whose turn it is, or null — the driver's cue to fold an `ai_turn` (spec §4.6). */
export const pending_mob_turn = (chain) => {
  const id = current_actor(chain)
  return id != null && chain.sim_state.team1.some((e) => e.id === id) ? id : null
}

/**
 * The store's staged draft → sim commands (spec §4.5). Staged rows are `{ kind, target }` where kind 0 = one
 * move STEP (the drafted path, in order), 1 = a cast. A turn always closes with `end_turn` — a zero-draft turn
 * still commits, which is what hands the mobs their wave (turn_commit.js `auto_commit_decision`).
 * @param {Array<{ kind:number, target:number, spell_template_id?:string }>} staged
 * @param {string} entity_id
 */
export const commands_from_staged = (staged, entity_id) => {
  const flush = (acc) =>
    acc.path.length > 0 ? [...acc.commands, { type: 'move', entity_id, path: acc.path }] : acc.commands
  const folded = (staged ?? []).reduce(
    (acc, action) => {
      if (action.kind === 0) return { ...acc, path: [...acc.path, decode(Number(action.target))] }
      if (action.kind === 1)
        return {
          path: [],
          commands: [
            ...flush(acc),
            {
              type: 'cast',
              entity_id,
              spell_id: String(action.spell_template_id),
              target: decode(Number(action.target)),
            },
          ],
        }
      // kind 2 is the §17.27 WEAPON strike: the sim reducer has no weapon command, so there is nothing
      // authoritative to fold. Loud, never a silent downgrade to "the player did nothing".
      throw new Error(`sim_chain: staged action kind ${action.kind} has no sim command`)
    },
    { commands: [], path: [] }
  )
  return [...flush(folded), { type: 'end_turn', entity_id }]
}

/** A staged row is a cast (spec §4.5 kind 1) — the rows the receipt owes a `Cast` for. */
const staged_casts = (staged) => (staged ?? []).filter((action) => action.kind === 1)

/**
 * WHY a staged cast folded nothing (#1012). The sim reducer answers every refusal the same way — the state
 * back, untouched, with no events — so the reason is re-derived from the state the turn started in, in the
 * order `handle_cast` gates them: the seat, its turn, the template, then the chain's own cast rules (AP,
 * range, LoS, casts_per_turn, casts_per_target, cooldown). Diagnosis only: the refusal is the invariant.
 * @param {object} chain the chain the turn was folded against
 * @param {{ entity_id: string, spell_id: string, recast: boolean }} cast
 * @returns {string}
 */
const cast_refusal_reason = (chain, { entity_id, spell_id, recast }) => {
  const state = chain.sim_state
  const caster = [...state.team0, ...state.team1].find((e) => e.id === entity_id)
  if (!caster) return `this fight holds no such fighter`
  if (current_actor(chain) !== entity_id) return `it is not that seat's turn`
  if (!chain.ctx.spell_templates.has(spell_id))
    return `this fight's ctx holds no template with that id — the fight was started on another id space`
  if (recast)
    return `the seat already cast that spell this turn — its published casts_per_turn / casts_per_target / cooldown refused the repeat`
  return `the sim refused it (range, line of sight, AP, or a cast limit)`
}

/**
 * THE PLAYER'S COMMITTED TURN (#1012) — `commands_from_staged` + the submit door, with the staged draft's own
 * receipt owed back. Every staged cast MUST produce its `Cast` row: the sim reducer declines a cast it cannot
 * honour by returning the state untouched with ZERO events, and encoding that as an ordinary turn is how a
 * player's card became a no-op — the turn committed, a version landed, and nothing said a word: no damage, no
 * AP spent, no refusal, nothing on the console. So the door REFUSES the whole turn instead, exactly as
 * `commands_from_staged` already refuses the kind-2 weapon strike. `fight_shim`'s `commit_turn` catches it,
 * logs it and returns false, which rolls the drafted turn back through the production failure path and leaves
 * the turn in the player's hands.
 *
 * The raw `submit_commands` stays tolerant on purpose: it is the door the mob AI, the abandon path and the
 * property oracle fold arbitrary commands through, where a refused command IS the case under test. A COMMITTED
 * TURN is the one place a refusal must never be a receipt.
 *
 * @param {object} chain
 * @param {Array<{ kind:number, target:number, spell_template_id?:string }>} staged the store's staged draft
 * @param {string} entity_id the seat committing
 * @param {{ now_ms?: number, turn_ms?: number }} [clock]
 * @returns {ReturnType<typeof submit_commands>}
 */
export const submit_staged = (chain, staged, entity_id, clock) => {
  const result = submit_commands(chain, commands_from_staged(staged, entity_id), clock)
  const cast_rows = result.receipt.events.filter((row) => String(row.type).endsWith('::Cast')).length
  const owed = staged_casts(staged)
  if (cast_rows === owed.length) return result
  const dissolved = owed[cast_rows] // the rows encode in staged order, so the first unpaid cast is this one
  const spell_id = String(dissolved?.spell_template_id)
  const recast = owed.slice(0, cast_rows).some((cast) => String(cast.spell_template_id) === spell_id)
  throw new Error(
    `sim_chain: cast of '${spell_id}' by '${entity_id}' folded nothing — ` +
      `${cast_refusal_reason(chain, { entity_id, spell_id, recast })}`
  )
}

/** STOP mid-fight (spec §4.7): every living roster seat forfeits, which drives the terminal rows. */
export const abandon_fight = (chain, clock) =>
  submit_commands(
    chain,
    chain.sim_state.team0.filter((e) => e.health > 0).map((e) => ({ type: 'abandon', entity_id: e.id })),
    clock
  )

/** The sim Capsule (timeline.js format) for this fight — commands + seed ⇒ a byte-stable re-fold, and a
 *  fixture candidate for `packages/sim/test/fixtures/replay/` (spec §8). */
export const capsule_of = (chain) => {
  const capsule = dump_capsule(chain.recorder, chain.fight_id)
  return capsule == null ? null : { ...capsule, meta: { ...capsule.meta, seed: chain.seed, fight_seed: chain.seed } }
}
