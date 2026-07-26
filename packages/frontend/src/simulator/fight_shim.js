// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_shim.js — the L4 CONTEXT SHIM (spec §11 · L4; the `dungeon_fight_shim.js` pattern applied to
// a local chain). It owns NO fight logic and NO encoding: `@aresrpg/fight/sim_chain` (lane L2) is the local
// chain — board, snapshot, submit door, ai turns, capsule — and `@aresrpg/fight/store` is the single fight-state
// owner. This file is only the EFFECT EDGE between them and the page:
//
//   (a) OPEN a fight in the core and feed the chain's snapshot into its ONE input door,
//   (b) seed the stores the production HUD reads (spec §6),
//   (c) route the player's committed turn into the chain and its receipt back into the door,
//   (d) pump the mob turns that follow, hold seat focus, and tear the session down,
//   (e) hand the two capsules to the trace export.
//
// ── THE SUBMIT SEAM (a build-time finding, spec §4.5 + §7.6) ────────────────────────────────────────────────
// The spec sketches the simulator injecting its submit through `subscribe_commit_due(store, { submit })`. At
// build time the MOUNTED production surface already owns that edge: `DungeonBoard.jsx` installs its own
// `subscribe_commit_due` (DungeonBoard.jsx:884) and routes the drafted turn to `use_dungeon`'s `commit_turn`
// (DungeonBoard.jsx:832, read as store state at :133). A SECOND subscriber on the same level-triggered
// projection would fire two submits for one turn. So the injection point is `commit_turn` ITSELF — seeded into
// the store exactly like every other dependency the surface reads. That is store seeding, not a fork: the
// surface file is untouched, and the same rule retires the S5 worry — `claim` / `mint_loot` / `abandon` are
// store-injected too (DungeonBoard.jsx:134-136), so the terminal path fires LOCAL no-ops and the simulator is
// structurally unable to sign a transaction. Nothing here imports a PTB composer; there is no chain call to
// extract.
//
// ── THE CLOCK ──────────────────────────────────────────────────────────────────────────────────────────────
// `sim_chain` is pure and total: wall-clock turn deadlines are INJECTED (`now_ms`). This shim is where the real
// clock enters, and nowhere else — determinism rides the capsule's command list, never the clock (spec §10).

import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_PLACEMENT, STATUS_WON } from '@aresrpg/fight/board_state'
import { GRID_W } from '@aresrpg/fight/los'
import {
  LOCAL_ADDRESS,
  abandon_fight,
  capsule_of,
  create_sim_chain,
  pending_mob_turn,
  snapshot_from_sim,
  submit_commands,
  submit_staged,
} from '@aresrpg/fight/sim_chain'

import { with_experience } from '../world-shell/seat_character.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { install_fight_trace_tee } from '../world-shell/fight_trace_tee.js'
import { context } from '../game/store.js'
import { game_log } from '../core/log.js'

import { hand_update_of } from './fight_setup.js'
import { export_sim_trace } from './trace_export.js'
import { save_trace } from './persistence'

export { LOCAL_ADDRESS }

/** Consecutive mob turns chain (spec §4.6) but never unboundedly — a planner that cannot advance the pointer
 *  must surface as a loud stop, not a hung page. Sized far past any real roster/mob count. */
export const MAX_CHAINED_MOB_TURNS = 64

/**
 * Arm the door tee BEFORE any fold, so the envelope capsule records this fight from its very first input
 * (spec §7.7). Idempotent per store; a no-op under node.
 */
export const arm_trace_tee = (store = fight_store) => {
  if (typeof window !== 'undefined') window.__ARES_FIGHT_TRACE_ENABLED = true
  install_fight_trace_tee(store)
}

/** The run status the production surface branches its result card on. The SIM decides the outcome; this only
 *  translates its winner into the status vocabulary. A DRAW (winner 2) reads as FAILED — the page paints its
 *  own draw banner over it (spec §4.4's last row). */
export const status_of = (sim_state) => {
  if (sim_state.winner === -1) return STATUS_ACTIVE
  return sim_state.winner === 0 ? STATUS_WON : STATUS_FAILED
}

/**
 * The simulator's fight session. One per page visit; `start` always opens a FRESH fight id.
 * Every collaborator is injectable so the shim is drivable headless.
 */
export const create_fight_shim = ({
  store = fight_store,
  dungeon = use_dungeon,
  engine_context = context,
  save = save_trace,
  schedule = (fn) => setTimeout(fn, 0),
  now = Date.now,
  log = game_log,
} = {}) => {
  // THE ONE mutable holder in this lane — the effect edge's live chain, exactly as `dev_synth_fight.js` holds
  // its `synth`. Every transform on it is pure (sim_chain); nothing else in the lane mutates.
  let live = /** @type {{ chain: any, fight_id: string, seed: number } | null} */ (null)

  /** Fold ONE receipt through the core's door. The store drops a version at or below its frontier, so this is
   *  idempotent under a double delivery — the property the real receipt lane relies on. */
  const feed = ({ version, receipt }) => {
    if (!live || !receipt?.events?.length) return
    store.getState().input({ type: 'receipt', version, receipt, fight_id: live.fight_id })
  }

  const sync_status = () => {
    if (!live) return
    dungeon.setState({
      dungeon: { ...dungeon.getState().dungeon, status: status_of(live.chain.sim_state) },
      busy: false,
    })
  }

  /** §4.6 — chain every consecutive mob turn, one receipt per turn so each mob's wave paces separately in the
   *  presentation fold. Deferred to the next macrotask so the prior batch's wave is already queued. */
  const pump_mobs = (depth = 0) => {
    if (!live || depth >= MAX_CHAINED_MOB_TURNS) return
    const mob = pending_mob_turn(live.chain)
    if (!mob) return sync_status()
    schedule(() => {
      if (!live) return
      const result = submit_commands(live.chain, [{ type: 'ai_turn', entity_id: mob }], { now_ms: now() })
      // A mob turn that folds nothing means the planner and the turn pointer disagree — stop LOUDLY rather
      // than spin the chain forever on a seat that will never advance.
      if (result.chain.sim_state === live.chain.sim_state)
        return log('simulator', 'mob turn stalled — the planner did not advance the turn pointer', { mob })
      live = { ...live, chain: result.chain }
      feed(result)
      return pump_mobs(depth + 1)
    })
  }

  /**
   * THE INJECTED SUBMIT (see the header). Receives the SAME staged action rows the real PTB composer reads and
   * returns the boolean `commit_turn`'s callers expect: `false` rolls the optimistic prediction back through
   * the core's own machinery — the production failure path, with no simulator-special handling.
   */
  const commit_turn = async (actions, { background = false } = {}) => {
    // NO SILENT REFUSAL (#922): a commit that returns false rolls the player's whole drafted turn back, so every
    // refusal names itself. This one fired on a STOP/teardown race and used to return false without a word.
    if (!live) {
      log('simulator', 'commit dropped — no live fight (started? torn down?)', { background })
      return false
    }
    // THE SEAT IS A PROJECTION, NOT A SLICE (#922 root cause). `active_entity_id` is computed by
    // `fight_view`/`engine_view` (project.js:508) out of the folded turn pointer — the raw `store.getState().view`
    // is the adopted BOARD snapshot and has never carried that field. Reading it off the slice therefore yielded
    // `undefined` on every single press: END TURN refused forever, the turn never ended, and the only trace was
    // DungeonBoard's `flush_finished ok:false`. This is the SAME door the HUD reads (`use_fight_view`), so the
    // seat the shim commits for is by construction the seat the board is showing as active.
    const seat = fight_view(store.getState())?.active_entity_id ?? null
    if (!seat) {
      log('simulator', 'commit dropped — no active seat at fire time', { background })
      return false
    }
    try {
      const before = live.chain.violations.length
      // THE STAGED DOOR (#1012), never the raw one: a staged cast the sim declines must refuse the turn rather
      // than commit a version that carries no cast, no damage and no AP spend.
      const result = submit_staged(live.chain, actions, seat, { now_ms: now() })
      live = { ...live, chain: result.chain }
      feed(result)
      if (result.chain.violations.length > before)
        log('simulator', 'physics tripwire fired on a committed turn', { violations: result.chain.violations })
      sync_status()
      pump_mobs()
      return true
    } catch (error) {
      // `submit_staged` throws by design on a staged row the chain cannot land: a kind-2 weapon strike (no sim
      // command) or a cast the sim declined (#1012 — the error names which of the two, and why).
      // Loud and refused: committing a turn the player did not draft is worse than refusing this one.
      log('simulator', 'commit refused — a staged action did not fold', error)
      return false
    }
  }

  /**
   * STOP (spec §4.7). Mid-fight this ABANDONS through the sim, so the terminal is the sim's own verdict and the
   * production result card opens for a real reason; the page reducer's `fight_stopped` then returns to setup.
   */
  const stop = () => {
    if (!live) return { ok: false, reason: 'no_fight' }
    if (live.chain.sim_state.winner === -1) {
      const result = abandon_fight(live.chain, { now_ms: now() })
      live = { ...live, chain: result.chain }
      feed(result)
    }
    dungeon.setState({ dungeon: { ...dungeon.getState().dungeon, status: STATUS_PLACEMENT }, busy: false })
    return { ok: true }
  }

  /** The store seeds the production fight surface reads (spec §6, the dev_synth_fight seed set) — plus the
   *  four LOCAL doors that keep the terminal path off the chain (header: the S5 answer). */
  const seed_stores = ({ fight_id, roster, mobs, width, height }) => {
    if (!engine_context.get_state().sui?.characters?.length)
      engine_context.dispatch('action/sui_data', {
        // A CHAIN CHARACTER CARRIES `experience`, NOT `level` (#949) — every consumer decodes the level off the
        // xp curve, so the row speaks BOTH: `experience` for them, `level` for the picker. The derivation has
        // ONE home (`with_experience`), the same one the HUD applies to any seat this GUARDED door never got to
        // build (#1001) — the guard stays, because a real session's roster must never be clobbered by a sandbox
        // seat, and no gate may depend on whether it opened.
        characters: roster.map(({ id, name, class_id, level }) =>
          with_experience({ id, name, classe: class_id, level, in_dungeon: false })
        ),
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
      // NO CHAIN BEHIND THIS SESSION (#921 ④). The production HUD embodies the post-deadline janitors — it
      // auto-presses a late turn and auto-cranks a stalled one, because on chain those doors exist and a
      // fight must never wedge on an away player. Here they do not: `sim_chain` is pure, its turn deadline is
      // this shim's own wall clock, and STOP is the only exit. So the composition SAYS SO, once, here — and
      // the shared surface reads that instead of guessing from a deadline that means something else.
      chain_backed: false,
      dungeon: { status: STATUS_ACTIVE, width, height, escrow: roster.map(({ id }) => id) },
      mob_names: Object.fromEntries(mobs.map(({ template_id, name }) => [template_id, name])),
      mob_levels: Object.fromEntries(mobs.map(({ template_id, level }) => [template_id, level])),
      mob_elements: Object.fromEntries(mobs.map(({ template_id, element }) => [template_id, element ?? 0])),
      // ── the local doors (no chain, no gas, no signature) ──
      commit_turn,
      claim: async () => {},
      mint_loot: async () => {},
      abandon: async () => stop(),
      place_at_cell: async () => false,
    })
  }

  /**
   * START (spec §4.3). `create_sim_chain` derives the board from the seed, places and readies every seat
   * through the reducer door (so the capsule's command list is complete) and hands back a started chain; the
   * snapshot it builds is the bootstrap base the core's door adopts at version 1.
   *
   * `templates_raw` are the AUTHORED corpus rows, not a normalized map: the chain normalizes them through the
   * sim's own door and records them verbatim, which is what makes its capsule replay to the same terminal.
   *
   * @param {{ seed:number, fight_id:string, team0:any[], team1:any[], templates_raw:any[],
   *   roster:any[], mobs:any[], focus_id?:string|null, anchor?:object }} params
   */
  const start = ({ seed, fight_id, team0, team1, templates_raw, roster, mobs, focus_id = null, anchor = {} }) => {
    if (!team0?.length) return { ok: false, reason: 'empty_roster' }
    if (!team1?.length) return { ok: false, reason: 'no_mobs' }
    arm_trace_tee(store)
    const chain = create_sim_chain({ seed, fight_id, team0, team1, templates_raw, anchor })
    live = { chain, fight_id, seed }
    // THE SEAT THE PLAYER HOLDS — the ctx's `my_entity_id` and the hand the bar opens on are the same seat, so
    // it is read once here rather than spelled twice.
    const seat_id = focus_id ?? roster[0]?.id ?? null
    seed_stores({ fight_id, roster, mobs, width: chain.board.width, height: chain.board.height })
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: null,
      ctx: {
        address: LOCAL_ADDRESS,
        // THE SEAT NAMES (#883 ③). `snapshot_from_sim` carries no `name` on a participant row (the chain's
        // own participant has none either), so the core's projection falls back to `ctx.roster` and, failing
        // that, prints the OWNER ADDRESS — every sim seat read as `0X51M0…0000` on its turn card. The roster
        // is handed straight to the core here rather than hoped for on the engine's global `sui.characters`,
        // which on this page holds whatever the world session last loaded (often the player's real roster,
        // which never contains `sim_c1`).
        roster: roster.map(({ id, name, class_id, level }) => ({ id, name, classe: class_id, level })),
        my_entity_id: seat_id,
        creator: LOCAL_ADDRESS,
        spectator: false,
        run: null,
        rooms_total: 0,
        mob_names: dungeon.getState().mob_names,
        mob_levels: dungeon.getState().mob_levels,
        mob_elements: dungeon.getState().mob_elements,
        offset: { x: 0, z: 0 }, // identity codec — the board's anchor is already world space (dev_synth precedent)
        // The canonical stride, imported — never the literal 20. `GRID_W` is the ONE home (los.js's D75-stride
        // keystone, matched to combat_grid.move); a copy here would be a fight fact with a second implementation
        // inside the simulator composition, which is exactly issue #914's defect class.
        beat_ctx: { grid_width: GRID_W },
      },
    })
    store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(chain, { now_ms: now() }), version: 1 })
    // THE SEAT'S CASTABLE SET (#949). The snapshot carries none, so without this the spell bar opens EMPTY
    // and a level-200 seat reads as "this character has just its first spells".
    const hand_update = hand_update_of(chain.sim_state, seat_id)
    if (hand_update) store.getState().input({ ...hand_update, fight_id })
    pump_mobs() // the turn weave can open on a mob seat
    return { ok: true, fight_id }
  }

  /** Seat focus (spec §6) — the production MULTICHAR path; the core re-resolves `my_key` from the new entity.
   *  The bar holds a SINGLE seat's spells, so the new seat's go through the same door the open used (#949) —
   *  otherwise focus switches the board and leaves the previous seat's spells armed on the bar. */
  const focus_seat = (character_id) => {
    store.getState().input({ type: 'ctx', ctx: { my_entity_id: character_id } })
    const hand_update = live && hand_update_of(live.chain.sim_state, character_id)
    if (hand_update) store.getState().input({ ...hand_update, fight_id: live.fight_id })
  }

  /** Full teardown — the core forgets the fight (a fresh session generation drops any in-flight async input). */
  const dispose = () => {
    live = null
    store.getState().input({ type: 'init', fight_id: null, my_key: null, ctx: {} })
  }

  /** The TRACE button (spec §8): the dual capsule, both halves seed-rooted. */
  const export_trace = () => {
    if (!live) return { ok: false, reason: 'no_fight' }
    return export_sim_trace({
      seed: live.seed,
      fight_id: live.fight_id,
      sim_capsule: capsule_of(live.chain),
      save,
      now,
    })
  }

  return { start, stop, dispose, focus_seat, commit_turn, export_trace, chain: () => live?.chain ?? null }
}
