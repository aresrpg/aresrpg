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
import { rng_int, rng_seed } from '@aresrpg/sim/prng'
import { board_seed_from_anchor, generate } from '@aresrpg/sim/board_gen'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'
import { create_recorder, dump_capsule, observe_reduce_checked, open_recording } from '@aresrpg/sim/recorder'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'

import { decode, encode } from './los.js'
import { DEFAULT_TURN_MS, encode_sim_step, side_of, status_rows_from_sim } from './sim_chain_events.js'

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

/**
 * Build the decoded-`Fight` the core's snapshot door adopts. Field set + naming follow the two existing
 * hand-builders verbatim (fight_board_simdrive.test.js `decoded_fight`, dev_synth_fight.js `decoded_fight`) —
 * raw `participant.move` / `mob.move` names, cells in canonical stride-20.
 * @param {object} chain
 * @param {{ now_ms?: number, turn_ms?: number }} [clock]
 */
export const snapshot_from_sim = (chain, { now_ms = 0, turn_ms = DEFAULT_TURN_MS } = {}) => {
  const { sim_state, board, anchor_x, anchor_z, fight_id, seed } = chain
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
      casts_this_turn: 0,
      weapon: null,
      stats: { agility: e.stats?.agility ?? 0 },
      base_stats: { range: e.stats?.range ?? 0 },
    })),
    mobs: sim_state.team1.map((e) => ({
      template: e.template_id ?? null,
      level: e.level,
      hp: e.health,
      max_hp: e.health_max,
      cell: encode(e.cell.x, e.cell.y),
      ap: e.ap,
      mp: e.mp,
      stats: { agility: e.stats?.agility ?? 0 },
      base_stats: { range: e.stats?.range ?? 0 },
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
    // The simulator's object read STATES the statuses the sim holds. `[]` is not "we did not look" — the
    // store's omission-hold law reads any array as authoritative (fold.js `carry_statuses`), so a hardcoded
    // empty set wiped every live invisibility and buff badge on each refresh (#952).
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
  const ctx = { spell_templates: normalize_spell_templates(templates_raw), arena }
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
const fold_command = (chain, command) => {
  const { state, events } = reduce(chain.sim_state, command, chain.ctx)
  const tapped = observe_reduce_checked(chain.recorder, {
    fight_id: chain.fight_id,
    command,
    pre_state: chain.sim_state,
    post_state: state,
    events,
  })
  return {
    chain: {
      ...chain,
      sim_state: state,
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
 * @returns {{ chain: object, version: number, receipt: { events: object[] }, hand_updates: object[] }}
 */
export const submit_commands = (chain, commands, { now_ms = 0, turn_ms = DEFAULT_TURN_MS } = {}) => {
  const folded = commands.reduce(
    (acc, command) => {
      const step = fold_command(acc.chain, command)
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
      })
      return {
        chain: step.chain,
        rows: [...acc.rows, ...encoded.rows],
        hand_updates: [...acc.hand_updates, ...encoded.hand_updates],
        actions: encoded.actions,
      }
    },
    { chain, rows: [], hand_updates: [], actions: chain.actions ?? {} }
  )
  const version = chain.version + 1
  return {
    chain: { ...folded.chain, version, actions: folded.actions },
    version,
    receipt: { events: folded.rows },
    hand_updates: folded.hand_updates,
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
