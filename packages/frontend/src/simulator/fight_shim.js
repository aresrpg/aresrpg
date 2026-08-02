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
// store-injected too (DungeonBoard.jsx:134-136), so the terminal path runs LOCALLY and the simulator is
// structurally unable to sign a transaction. Nothing here imports a PTB composer; there is no chain call to
// extract. LOCAL is not NO-OP though (#1632): `claim` carries the fight-over TRANSITION as well as the reward,
// so its local twin is `finish` below — only the reward half has nothing to do here.
//
// ── THE RUN STATUS HAS ONE WRITER (#1646) ──────────────────────────────────────────────────────────────────
// `use_dungeon.dungeon` is published by exactly one thing: the projection mirror in `dungeon_run_store.js`
// (`fight_store.subscribe(s => setState({ dungeon: board_view(s) }))`). This shim used to publish a SECOND
// `status` off `live.chain.sim_state.winner` — a translation of the same fact, on a field the mirror
// overwrites wholesale on its very next pass. The sim's verdict already reaches the store the honest way:
// `sim_chain_events` encodes `fight_ended` as the chain's own Victory/Defeat row, the core folds it, and the
// projection derives the status from that fold. So the second writer is gone; nothing here writes it.
//
// #1687 finished the job on the SESSION-lifecycle half. `seed_stores` used to open a board with
// `{ status: STATUS_ACTIVE, width, height, escrow: [] }` and `stop()` used to force `{ status:
// STATUS_PLACEMENT }` — session transitions, but written onto the mirror's own field. Neither survived its own
// write: the seed is superseded two statements later by `init` (which nulls the mirror) and then by the adopted
// snapshot, which carries the real status, geometry AND escrow; and STOP abandons THROUGH the sim first, so the
// fold's verdict is a terminal and a written PLACEMENT told the page the fight had gone back to seat picking.
// The core needed no new vocabulary for either — it already publishes both. `stop` keeps `busy`, which is its
// own field and outside the mirror's patch.
//
// ── THE CLOCK ──────────────────────────────────────────────────────────────────────────────────────────────
// `sim_chain` is pure and total: wall-clock turn deadlines are INJECTED (`now_ms`). This shim is where the real
// clock enters, and nowhere else — determinism rides the capsule's command list, never the clock (spec §10).

import { fight_store } from '@aresrpg/fight/store'
import { engine_view_of } from '@aresrpg/fight/project'
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
import { hold_until_presented } from '../world-shell/dungeon_fight_shim.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { mark_active_seat } from '../fight-engine/phase.js'
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
  on_finish = null,
} = {}) => {
  // THE ONE mutable holder in this lane — the effect edge's live chain, exactly as `dev_synth_fight.js` holds
  // its `synth`. Every transform on it is pure (sim_chain); nothing else in the lane mutates.
  let live = /** @type {{ chain: any, fight_id: string, seed: number } | null} */ (null)

  /** Fold ONE receipt through the core's door. The store drops a version at or below its frontier, so this is
   *  idempotent under a double delivery — the property the real receipt lane relies on.
   *
   *  `trap_cells` rides along exactly as all three world call sites send it (dungeon_run_store's commit, its
   *  overdue retry and its forfeit): the fold attributes a trap-triggered wave to the seat that OWNS the trap
   *  off this list, so a shim that omitted it published every one of the player's own trap procs as ownerless.
   *  Read from the same projection door the HUD reads, at fire time. */
  const feed = ({ version, receipt }) => {
    if (!live || !receipt?.events?.length) return
    store.getState().input({
      type: 'receipt',
      version,
      receipt,
      fight_id: live.fight_id,
      trap_cells: engine_view_of(store.getState())?.my_traps ?? [],
    })
  }

  /** §4.6 — chain every consecutive mob turn, one receipt per turn so each mob's wave paces separately in the
   *  presentation fold. Deferred to the next macrotask so the prior batch's wave is already queued. */
  const pump_mobs = (depth = 0) => {
    if (!live || depth >= MAX_CHAINED_MOB_TURNS) return
    const mob = pending_mob_turn(live.chain)
    if (!mob) return
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
    // THE RECEIPT NEVER LANDS INSIDE THE CALLER'S STACK. A chain submit crosses the network, so its receipt always
    // re-enters the fight core's ONE door from a LATER task; every consumer of that door is built on it. The local
    // chain is pure and synchronous, so without this yield the whole submit → fold → `input({type:'receipt'})` ran
    // inside the zustand NOTIFICATION that fired it — the deadline auto-commit is a store subscriber
    // (`fight/txs.js subscribe_commit_due`), observing the `commit_due` flag raised by the very `tick` input it
    // re-enters. `with_core_fold` (fight/store.js) folds the core BEFORE calling the door and writes it back
    // AFTER, so a nested input's fold is overwritten on the outer call's way out: the whole committed turn was
    // admitted and then discarded. The SIM kept it (the mobs planned against the moved-to cell) while the client
    // fell back to the adopted base snapshot — the fight's START cell — and that turn's status rows went with it.
    // The resulting start-cell rollback and lost-buff defects shared this root. `pump_mobs` already deferred
    // through `schedule`, which is why only the PLAYER's own turn was ever lost. Ordering is untouched: callers
    // await this promise, so the fold still completes before they
    // continue.
    await Promise.resolve()
    // NO SILENT REFUSAL (#922): a commit that returns false rolls the player's whole drafted turn back, so every
    // refusal names itself. This one fired on a STOP/teardown race and used to return false without a word.
    if (!live) {
      log('simulator', 'commit dropped — no live fight (started? torn down?)', { background })
      return false
    }
    // THE SEAT IS A PROJECTION, NOT A SLICE (#922 root cause). `active_entity_id` is computed by
    // `engine_view_of` (project.js) out of the folded turn pointer — the raw `store.getState().view`
    // is the adopted BOARD snapshot and has never carried that field. Reading it off the slice therefore yielded
    // `undefined` on every single press: END TURN refused forever, the turn never ended, and the only trace was
    // DungeonBoard's `flush_finished ok:false`. This is the SAME door the HUD reads (`useFightView`), so the
    // seat the shim commits for is by construction the seat the board is showing as active.
    const seat = engine_view_of(store.getState())?.active_entity_id ?? null
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
    // `busy` is this door's own field; the board itself belongs to the mirror, which has already published the
    // abandon terminal the fold above produced (#1687).
    dungeon.setState({ busy: false })
    return { ok: true }
  }

  /**
   * THE TERMINAL EXIT (#1632) — the seeded `claim`. On chain, `claim()` is not a reward button: it IS the whole
   * fight-over transition (dungeon_run_store.js), and DungeonBoard fires it from ONE level-triggered effect the
   * instant the killing receipt folds (`dungeon.decided_winner`). Seeding it as a bare `async () => {}` — because
   * a sandbox has nothing to claim — left a DECIDED fight with no exit at all: the frozen board and its dead mob
   * stood there forever, the auto-commit loop kept cycling on the surface behind them, and the setup screen never
   * came back. A local no-op is only sound for a door that owes the page nothing; this one owes it the transition.
   *
   * The HOLD is the same one the chain path uses: collapse only once the killing wave has drained, so the fight
   * never disappears out from under its own last beat. Where it collapses TO belongs to the page — `useSimFight`
   * owns start/stop and is the one home for "a simulator fight session ended".
   */
  const finish = () => {
    if (!live || live.chain.sim_state.winner === -1) return
    if (!on_finish)
      return log('simulator', 'fight over, but this shim has no session owner to return to — board left frozen')
    hold_until_presented(() => on_finish())
  }

  /** The store seeds the production fight surface reads (spec §6, the dev_synth_fight seed set) — plus the
   *  four LOCAL doors that keep the terminal path off the chain (header: the S5 answer). */
  const seed_stores = ({ fight_id, roster, mobs }) => {
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
      // NO `dungeon` KEY (#1026 → #1687). The board — status, geometry and participant rows alike — belongs to
      // the snapshot → board_view mirror, and `init` below nulls it before the snapshot republishes it. A seed
      // here would only be a second writer racing its own successor two statements later.
      mob_names: Object.fromEntries(mobs.map(({ template_id, name }) => [template_id, name])),
      mob_levels: Object.fromEntries(mobs.map(({ template_id, level }) => [template_id, level])),
      mob_elements: Object.fromEntries(mobs.map(({ template_id, element }) => [template_id, element ?? 0])),
      // ── the local doors (no chain, no gas, no signature) ──
      commit_turn,
      claim: async () => finish(),
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
    seed_stores({ fight_id, roster, mobs })
    // THE POLL ANALOGUE (#1056). The phase machine's D81 latch — "this client reached an ACTIVE, seated turn in
    // THIS fight" — is what makes a WON/FAILED read an EARNED terminal instead of an unearned one, and an
    // unearned terminal is EXIT: the fight layer unmounts and the adapter tears the board down, so winning a
    // simulator fight went BLACK where the victory sequence belongs. On chain the latch fires from the 4s poll
    // (dungeon_run_store.refresh, off an ACTIVE read); this page has no poll, and START *is* that observation —
    // it opens an ACTIVE fight on a seat this client holds. So it is latched here, once, at the same moment the
    // stores learn the fight is ACTIVE. Keyed by fight id, exactly like the chain's, so nothing leaks to a
    // later session. (dev_synth_fight.js does the same for the synthetic-fight rig, by folding a second read.)
    mark_active_seat(fight_id)
    store.getState().input({
      type: 'init',
      fight_id,
      my_key: null,
      ctx: {
        address: LOCAL_ADDRESS,
        // THE SEAT NAMES (#883 ③). `snapshot_from_sim` carries no `name` on a participant row (the chain's
        // own participant has none either), so the core's projection falls back to `ctx.roster` and, failing
        // that, prints the wallet address — every sim seat read as `0X51M0…0000` on its turn card. The roster
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
