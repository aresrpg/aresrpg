// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_shim.js — the L4 CONTEXT SHIM (spec §11 · L4; the `dungeon_fight_shim.js` pattern applied to
// a local chain). It owns NO fight logic: the sim is the authority (fight_driver.js), the fight core is the
// single fight-state owner, and this file only (a) OPENs a fight in the core, (b) feeds the sim's snapshot and
// receipts into the core's ONE input door, (c) seeds the stores the production HUD reads, (d) routes the
// player's committed turn into the sim and the mob turns back out, and (e) tears the session down.
//
// ── THE SUBMIT SEAM (a build-time finding, spec §4.5 + §7.6) ────────────────────────────────────────────────
// The spec sketches the simulator injecting its submit through `subscribe_commit_due(store, { submit })`. At
// build time the MOUNTED production surface already owns that edge: `DungeonBoard.jsx` installs its own
// `subscribe_commit_due` (DungeonBoard.jsx:884) and routes the drafted turn to `use_dungeon`'s `commit_turn`
// (DungeonBoard.jsx:832, read as store state at :133). Installing a SECOND subscriber on the same level-
// triggered projection would fire two submits for one turn. So the injection point is `commit_turn` ITSELF —
// seeded into the store exactly like every other dependency the surface reads. That is store seeding, not a
// fork: the surface is untouched, and the same rule retires the S5 worry — `claim` / `mint_loot` / `abandon`
// are store-injected too (DungeonBoard.jsx:134-136), so the terminal path fires LOCAL no-ops and the simulator
// can never sign a transaction. Nothing here imports a PTB composer; there is no chain call to extract.
//
// ── THE L2 SEAM ────────────────────────────────────────────────────────────────────────────────────────────
// `snapshot_from_sim` and `encode_sim_step` are lane L2's (`packages/fight/src/sim_chain.js`), imported through
// sim_chain_seam.js and INJECTABLE here. Until L2 lands, `start` refuses honestly rather than mounting a board
// over a fight that cannot be encoded.

import { fight_store } from '@aresrpg/fight/store'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_PLACEMENT, STATUS_WON } from '@aresrpg/fight/board_state'

import { use_dungeon } from '../world-shell/dungeon_store.js'
import { install_fight_trace_tee } from '../world-shell/fight_trace_tee.js'
import { context } from '../game/store.js'
import { game_log } from '../game/core/log.js'

import { abandon_all, active_seat, commit_batch, create_session, drive_mob_turns, is_over } from './fight_driver.js'
import { stage_to_commands } from './turn_mapping.js'
import { encode_sim_step, sim_chain_ready, snapshot_from_sim } from './sim_chain_seam.js'
import { export_sim_trace } from './trace_export.js'
import { save_trace } from './persistence'

/** The local "wallet". Every roster seat is owned by it, so `fight_control.controlled_character_ids` returns
 *  the WHOLE roster and the production seat-focus switching drives the multi-account simulation with zero new
 *  mechanism (spec §6). Marked `sim` so it can never be mistaken for a chain address. */
export const LOCAL_ADDRESS = '0xsim0000000000000000000000000000000000000000000000000000000000000'

/** Real-clock turn deadline (spec §10 divergence 2 — determinism rides the command list, never the clock). */
export const TURN_MS = 120_000

/**
 * Arm the door tee BEFORE any fold, so the envelope capsule records this fight from its very first input
 * (spec §7.7). The tee is idempotent per store and a no-op under node.
 */
export const arm_trace_tee = (store = fight_store) => {
  if (typeof window !== 'undefined') window.__ARES_FIGHT_TRACE_ENABLED = true
  install_fight_trace_tee(store)
}

/**
 * The simulator's fight session. One per page visit; `start` always opens a FRESH fight id.
 *
 * @param {object} [deps] every collaborator is injectable so the shim is drivable headless
 */
export const create_fight_shim = ({
  store = fight_store,
  dungeon = use_dungeon,
  engine_context = context,
  encode_step = encode_sim_step,
  build_snapshot = snapshot_from_sim,
  chain_ready = sim_chain_ready,
  save = save_trace,
  schedule = (fn) => setTimeout(fn, 0),
  log = game_log,
} = {}) => {
  // THE ONE mutable holder in this lane — the effect edge's live session, exactly as `dev_synth_fight.js`
  // holds its `synth`. Every transform on it is pure (fight_driver.js); nothing else in the lane mutates.
  let live = /** @type {{ session: any, ctx: any, seed: number, fight_id: string } | null} */ (null)

  /** Fold ONE receipt through the core's door. The store drops a version at or below its frontier, so this is
   *  idempotent under a double delivery — the same property the real receipt lane relies on. */
  const feed = (receipt) => {
    if (!receipt || !live) return
    store.getState().input({ ...receipt, fight_id: live.fight_id })
  }

  /** §4.6 — after a batch, chain every consecutive mob turn and feed each as its OWN receipt (one wave per mob
   *  turn). Deferred to the next macrotask so the prior batch's presentation wave is already queued. */
  const pump_mobs = () => {
    if (!live) return
    const seat = active_seat(live.session)
    if (!seat || seat.is_player) return
    schedule(() => {
      if (!live) return
      const driven = drive_mob_turns(live.session, live.ctx, encode_step)
      live = { ...live, session: driven.session }
      for (const receipt of driven.receipts) feed(receipt)
      if (driven.stalled_on) log('simulator', 'mob turn stalled — the planner and the turn pointer disagree', driven)
      dungeon.setState({ busy: false })
    })
  }

  /**
   * THE INJECTED SUBMIT (see the header). Receives the SAME staged action rows the real PTB composer reads.
   * Returns the boolean `commit_turn`'s callers expect: `false` rolls the optimistic prediction back through
   * the core's own machinery, which is exactly the production failure path — no simulator-special handling.
   */
  const commit_turn = async (actions, { background = false } = {}) => {
    if (!live) return false
    const seat = active_seat(live.session)
    if (!seat || !seat.is_player) {
      log('simulator', 'commit dropped — it is not a player seat’s turn', { seat, background })
      return false
    }
    const { commands, rejected } = stage_to_commands(actions, {
      sim_state: live.session.sim_state,
      arena: live.ctx.arena,
      entity_id: seat.id,
    })
    if (rejected.length) {
      // Loud, never silent: committing a turn the player did not draft is worse than refusing this one.
      log('simulator', 'commit refused — a staged action could not be mapped to a sim command', { rejected })
      return false
    }
    const result = commit_batch(live.session, commands, live.ctx, encode_step)
    if (!result.ok) {
      log('simulator', 'commit refused by the sim authority', { command: result.error })
      return false
    }
    live = { ...live, session: result.session }
    feed(result.receipt)
    dungeon.setState({ dungeon: { ...dungeon.getState().dungeon, status: status_of(result.session) } })
    pump_mobs()
    return true
  }

  /** The run status the production surface branches its result card on. The SIM decides the outcome; this only
   *  translates its winner into the status vocabulary (`board_state.js`). A DRAW (winner 2) reads as FAILED —
   *  the page shows its own draw banner over it (spec §4.4's last row). */
  const status_of = (session) => {
    if (!is_over(session)) return STATUS_ACTIVE
    return session.sim_state.winner === 0 ? STATUS_WON : STATUS_FAILED
  }

  /** The store seeds the production fight surface reads (spec §6, the dev_synth_fight seed set) — plus the
   *  four LOCAL no-op doors that keep the terminal path off the chain (header: the S5 answer). */
  const seed_stores = ({ fight_id, roster, mob_names, mob_levels, mob_elements, width, height }) => {
    if (!engine_context.get_state().sui?.characters?.length)
      engine_context.dispatch('action/sui_data', {
        characters: roster.map(({ id, name, class_id, level }) => ({
          id,
          name,
          classe: class_id,
          level,
          in_dungeon: false,
        })),
        loaded: true,
        load_error: null,
        has_claimed_free_character: true,
      })
    dungeon.setState({
      fight_id,
      fight_fresh: false,
      dungeon_id: fight_id,
      world_id: null,
      template_id: null,
      character_id: roster[0]?.id ?? null,
      run_pass_id: null,
      run: null,
      rooms: [],
      result_id: null,
      phase: 'playing',
      error: null,
      in_session: false,
      session_address: LOCAL_ADDRESS,
      busy: false,
      dungeon: { status: STATUS_ACTIVE, width, height, escrow: roster.map(({ id }) => id) },
      mob_names,
      mob_levels,
      mob_elements,
      // ── the local doors (no chain, no gas, no signature) ──
      commit_turn,
      claim: async () => {},
      mint_loot: async () => {},
      abandon: async () => stop(),
      place_at_cell: async () => false,
    })
  }

  /**
   * START (spec §4.3). Placement and ready-up are folded into the sim FIRST and the snapshot is taken from the
   * POST-ready state, so the bootstrap snapshot already carries the established turn order, the placed seats
   * and `turn_ptr` — the same way mobs are pre-placed in it (§4.4's mapping table). The Placed/Ready/started
   * rows are therefore absorbed by the snapshot rather than replayed as a receipt on top of it; replaying them
   * would fold the same facts twice into a log the snapshot already subsumes.
   */
  const start = ({ seed, fight_id, arena, board, team0, team1, roster, mobs, spell_templates, focus_id = null }) => {
    if (!chain_ready())
      return { ok: false, reason: 'sim_chain_missing' } // the local chain (lane L2) is not in this build
    if (!roster?.length) return { ok: false, reason: 'empty_roster' }
    if (!mobs?.length) return { ok: false, reason: 'no_mobs' }
    arm_trace_tee(store)
    const ctx = { spell_templates, arena }
    const placed = [...team0].reduce(
      (session, entity) => commit_batch(session, [{ type: 'ready', entity_id: entity.id }], ctx, encode_step).session,
      create_session({ fight_id, seed, arena, team0, team1 })
    )
    // the ready fold above is pre-fight bookkeeping — the snapshot subsumes it, so the version stays at the
    // bootstrap 1 and the first receipt this fight emits is a real turn.
    const session = { ...placed, version: 1 }
    live = { session, ctx, seed, fight_id }
    seed_stores({
      fight_id,
      roster,
      width: arena.width,
      height: arena.height,
      mob_names: Object.fromEntries(mobs.map(({ id, name }) => [id, name])),
      mob_levels: Object.fromEntries(mobs.map(({ id, level }) => [id, level])),
      mob_elements: Object.fromEntries(mobs.map(({ id, element }) => [id, element ?? 0])),
    })
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: null,
      ctx: {
        address: LOCAL_ADDRESS,
        my_entity_id: focus_id ?? roster[0]?.id ?? null,
        creator: LOCAL_ADDRESS,
        spectator: false,
        run: null,
        rooms_total: 0,
        mob_names: dungeon.getState().mob_names,
        mob_levels: dungeon.getState().mob_levels,
        mob_elements: dungeon.getState().mob_elements,
        offset: { x: 0, z: 0 }, // identity codec — the board's anchor is already world space (dev_synth precedent)
        beat_ctx: { grid_width: 20 },
      },
    })
    store.getState().input({
      type: 'snapshot',
      fight: build_snapshot(session.sim_state, board, roster, mobs),
      version: 1,
    })
    pump_mobs()
    return { ok: true, fight_id }
  }

  /** Seat focus (spec §6) — the production MULTICHAR path; the core re-resolves `my_key` from the new entity. */
  const focus_seat = (character_id) => store.getState().input({ type: 'ctx', ctx: { my_entity_id: character_id } })

  /**
   * STOP (spec §4.7). Mid-fight this ABANDONS through the sim so the terminal is the sim's own verdict and the
   * production result card opens for a real reason; the page reducer's `fight_stopped` then returns to setup.
   */
  const stop = () => {
    if (!live) return { ok: false, reason: 'no_fight' }
    if (!is_over(live.session)) {
      const result = abandon_all(live.session, live.ctx, encode_step)
      live = { ...live, session: result.session }
      feed(result.receipt)
    }
    dungeon.setState({ dungeon: { ...dungeon.getState().dungeon, status: STATUS_PLACEMENT }, busy: false })
    return { ok: true }
  }

  /** Full teardown — the core forgets the fight (a fresh session generation drops any in-flight async input). */
  const dispose = () => {
    live = null
    store.getState().input({ type: 'init', fight_id: null, my_key: null, ctx: {} })
  }

  /** The TRACE button (spec §8): the dual capsule, both halves seed-rooted. */
  const export_trace = (dump_sim_capsule = () => null) => {
    if (!live) return { ok: false, reason: 'no_fight' }
    return export_sim_trace({
      seed: live.seed,
      fight_id: live.fight_id,
      sim_capsule: dump_sim_capsule(),
      save,
    })
  }

  return { start, stop, dispose, focus_seat, commit_turn, export_trace, session: () => live?.session ?? null }
}
