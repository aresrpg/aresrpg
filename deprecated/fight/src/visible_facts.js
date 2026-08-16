// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/visible_facts.js — the record builders `fight_visible_view` composes (#1993, train 0).
//
// The VIEW — its six-key shape and its memoized door — lives in project_views.js, which is its one home. This
// file is that projection's helper half, split off for the same reason fold.js was split out of store.js: the
// ≤600-LoC cap. Nothing here is a second projection surface — every function is called by
// `fight_visible_view` and by nothing else, and none of them reads a store or holds state.
//
// Each builder returns ONE fight-visible fact's record AT CURRENT PARITY: the value today's fragment already
// produces (`engine_view` rows, the `project_state` predicates, `project_hud`'s pacing posture), regrouped and
// explicitly named. No reconciliation is introduced here — fold-first family migrations are later trains.

import { K_INVISIBILITY } from '@aresrpg/sim/spell_effect'

import { STATUS_FAILED, STATUS_ROOM_CLEARED, STATUS_WON } from './board_state.js'
import { decode as decode_xy } from './los.js'
import { range_bonus_of } from './statuses.js'
import { commit_fact, empty_result } from './result_record.js'
import { project_hud } from './core_project.js'
import { next_action_slot } from './turn_action_slot.js'
import { committed_truth, display_state, min_turn_ready_at, presented_state } from './store.js'
import {
  cast_presenting,
  chain_terminal_status,
  commit_due,
  deadline_starved,
  decided_outcome,
  draining,
  is_my_turn,
  is_over,
  phase,
  presenting,
  settlement_request,
  turn_playable,
} from './project_state.js'

/** END-TURN PRESS LAW + PRESENTATION GATE — ONE predicate for every turn-input surface: the my-turn wash, the
 *  raw cell click/hover relays, and FightControls' 3-state. It lives beside the projections it gates (rather
 *  than in project.js) so `fight_visible_view.turn.input_armed` and the control-phase verdict below call the one
 *  home instead of re-deriving it; project_views.js and project.js re-export both names verbatim, so every
 *  existing importer is untouched.
 *  `busy` is the run store's tx single-flight flag — true from commit_turn's FIRST line (END TURN press or a
 *  background auto-commit) through the whole in-flight window, so the wash/picking disarm at PRESS; a refused
 *  commit clears it with my_turn still true and the surfaces honestly restore. `presenting` disarms while a
 *  mob/peer replay drains (chain truth ⋀ presentation done).
 *  @param {boolean} my_turn @param {boolean} busy @param {boolean} [presenting_now] */
export const turn_input_armed = (my_turn, busy, presenting_now = false) => my_turn && !busy && !presenting_now

/** The state-shaped arming door: my HANDED-OVER turn (`turn_playable` — chain seat, nothing replaying, the
 *  chain's mob-resolution budget spent) and the fight undecided, not busy. `busy` stays an edge INPUT — the run
 *  store owns tx single-flight across MORE than turn commits (engage/place/settle), wider than the core's own
 *  commit-flight `s.busy`. The presentation gate lives INSIDE `turn_playable` now (#1808), so this reads one
 *  fact instead of re-assembling the boundary. */
export const input_armed = (s, { busy = false } = {}) => turn_input_armed(turn_playable(s) && !is_over(s), busy, false)

/** Recursively freeze plain objects/arrays — the view is handed out, never handed back. Non-plain values
 *  (numbers, strings, decoded cells built here) either freeze trivially or are already immutable. */
export const deep_freeze = (value) => {
  if (Array.isArray(value)) {
    for (const item of value) deep_freeze(item)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) deep_freeze(value[key])
    return Object.freeze(value)
  }
  return value
}

/** Session scope of a fight id — simulator sessions live under the canonical `sim:` namespace, chain Fight
 *  object ids do not. The same classifier the world shell already asks before treating a session as its own. */
const session_scope = (fight_id) => (fight_id == null ? null : String(fight_id).startsWith('sim:') ? 'sim' : 'world')

/**
 * One entity's POSITION — TWO facts, each named once and offered in both encodings (#1993 WP5, finding row
 * `project_views.js:175`: board positions used to be selected as committed, presented, display or the raw
 * snapshot cell depending on which projection a surface happened to reach for).
 *
 *   · COMMITTED — chain truth. Every gameplay, log and occupancy question answers from here: legality, LOS,
 *     body-blocking, vacancy, "where did this cast land". It is the only cell that is ever an ANSWER.
 *   · DISPLAY — where the body is SHOWN this frame. An in-flight walk HOLDS at its pre-move cell until the walk
 *     beat presents (SNAP-THEN-RUN) and a placement ghost overlays a peer's uncommitted pick, so this cell is
 *     deliberately allowed to lie about the board. It positions pixels; it never decides anything.
 *
 * `presented` — the paced fold cell — is neither: it is the INPUT display is derived from, kept named so the
 * pacing tests can see the step, and never a third answer. Encodings are two spellings of ONE fact, derived
 * here rather than by each consumer: `_xy` is the decoded `{x,y}`, the bare name is the encoded cell index.
 */
const entity_cells = (s, key, snapshot_cell, display_xy) => {
  const committed = committed_truth(s).fighters?.[key]?.cell ?? snapshot_cell ?? null
  const presented = presented_state(s).fighters?.[key]?.cell ?? snapshot_cell ?? null
  return {
    committed,
    committed_xy: committed == null ? null : decode_xy(committed),
    presented,
    display: display_state(s).fighters?.[key]?.cell ?? presented,
    display_xy: display_xy ?? null,
  }
}

/** The snapshot row's own cell — the fallback every fold read already takes when no folded row exists yet. */
const snapshot_cell_of = (view, key) => {
  if (key == null) return null
  const idx = Number(key.slice(1))
  return (key[0] === 'm' ? view?.mobs?.[idx]?.cell : view?.escrow?.[idx]?.cell) ?? null
}

/**
 * ONE ENTITY'S ACTIVE-STATUS PROJECTION (#1993 WP6, finding row `project_views.js:241`) — the fold's per-fighter
 * status home, and EVERY consequence that home implies, resolved HERE instead of by each surface that needs one.
 *
 * The rows were already one home; the CONSEQUENCES were not. The turn card and the hover card read the rows, the
 * board and the overlay each called `range_bonus_of` over them, the rig veil read a boolean beside them, and the
 * prediction re-derived its own sim effects — four surfaces re-answering one collection, which is how an effect
 * could paint in one place and not another (#1872's family). A consumer now names the consequence it wants.
 *
 * `invisible` IS THE FOLD'S ANSWER, NOT A RE-DERIVATION. The fold re-derives it from the surviving rows at every
 * door that writes one (`append_status_row` · `age_statuses` · `reveal_fighter`), so reading the rows here would
 * be a second derivation of the same fact — and a WRONG one, because `StanceChanged` can still set the flag with
 * no row behind it (the chain's stance event carries no duration to mint one from). That case is not silently
 * absorbed: `stance_only` NAMES it, the same way `visible_result.conflicts` names a winner disagreement instead
 * of consuming it. A veil with no row is the last live second-representation in this family, and it is now
 * measurable rather than merely suspected.
 * @param {any} fighter one `engine_view` fighter row
 */
const entity_statuses = (fighter) => {
  // The ACTIVE rows — the fold's per-fighter `statuses`, raw chain ints (engine_view's `effects`). Presence IS
  // activity (#2000, D42): the fold already dropped every spent row at its bearer's turn start, so this needs no
  // duration predicate of its own and must not invent one.
  const rows = fighter?.effects ?? []
  const invisible = !!fighter?.invisible
  return {
    rows,
    invisible,
    /** the veil is lit with no row to justify it — an unbacked stance, kept visible rather than absorbed */
    stance_only: invisible && !rows.some((row) => Number(row?.kind) === K_INVISIBILITY),
    /** the fighter's LIVE RANGE STAT — the immutable fight-start base (gear included) plus the active signed
     *  range rows, folded exactly once (`statuses.range_bonus_of`, its one home). A modifiable-range spell adds
     *  this to its authored reach; a fixed-range one ignores it. */
    range_bonus: range_bonus_of(fighter),
  }
}

/**
 * ENTITIES — the id-keyed rows: identity · cells · vitals · statuses. Built from the `engine_view` fighter rows,
 * whose health/liveness fields are themselves derivations of `vitals_record.js` (#1993 WP7) — so this record and
 * the legacy row names are one fold read twice, never two. A consumer names the fact it wants instead of
 * choosing between `health`, `presented_health` and `committed_health` at every call site.
 * @param {any} s the fight store state @param {any} engine the engine view, or null before a board is adopted
 * @param {Map<string, string>} keys entity id → thin-fold key (built by the projections' own key constructors)
 * @param {Record<string, any>} book the roster identity book — identity resolved once, id-keyed (#1993 WP3)
 */
export const visible_entities = (s, engine, keys, book = {}) => {
  const view = s?.view ?? null
  const entities = {}
  for (const [entity_id, fighter] of engine?.fighters ?? []) {
    const key = keys.get(entity_id) ?? null
    const identity = book[entity_id] ?? null
    entities[entity_id] = {
      id: entity_id,
      // IDENTITY — the roster identity book's row, verbatim. This view does not re-resolve anything and holds no
      // fallback of its own: `name` is the AUTHORED name or null (absence stays an id), `display_id` is the honest
      // id to show instead, and `label` is the one rule (`name ?? display_id`) already applied. A surface renders
      // `label` and branches on `resolved` — it never invents a substitute, which is how two surfaces used to
      // render one absent fighter under two different names (#1865).
      identity: {
        name: identity?.name ?? null,
        display_id: identity?.display_id ?? null,
        label: identity?.label ?? null,
        resolved: !!identity?.resolved,
        team: fighter.team,
        is_player: fighter.is_player,
        level: fighter.level,
        seat: identity?.seat ?? null,
        owner: fighter.owner ?? null,
        character_id: fighter.character_id ?? null,
        template: fighter.variant ?? null,
        class_id: fighter.class_id ?? null,
        element: fighter.element ?? null,
        sex: fighter.sex ?? null,
        male: fighter.male ?? null,
        colors: fighter.colors ?? null,
        hue: fighter.hue ?? null,
      },
      cells: entity_cells(s, key, snapshot_cell_of(view, key), fighter.cell),
      // VITALS — the record `vitals_record.js` folds (#1993 WP7); its header states the semantics in full.
      //   · `committed` — CHAIN TRUTH; every gameplay, legality and log question answers from here.
      //   · `presented` — the presentation fold (this client's prediction included). It is the INPUT `display`
      //     is derived from and what the pacing tests read; never a third answer.
      //   · `display`   — THE number a bar renders. ONE display HP for every live surface, named once.
      // LIVENESS IS DERIVED, never a parallel boolean: `alive` is committed truth (what targeting reads),
      // `display_alive` is the rendered one (the killing beat's ack holds it). A reader that means "dead"
      // negates the one it means — that negation is not a fact of its own and is no longer published as one.
      // AP/MP ride here as the seat's live budget, forwarded from the row that owns their fold; the budget
      // family is not this WP's (the HP audit rows are), so their derivation is untouched.
      vitals: {
        committed: fighter.committed_health ?? null,
        presented: fighter.health ?? null,
        display: fighter.presented_health ?? null,
        max: fighter.health_max ?? null,
        alive: !!fighter.committed_alive,
        display_alive: !fighter.dead,
        ap: fighter.ap ?? null,
        ap_max: fighter.ap_max ?? null,
        mp: fighter.mp ?? null,
        mp_max: fighter.mp_max ?? null,
      },
      statuses: entity_statuses(fighter),
    }
  }
  return entities
}

/**
 * TURN — order, actors, phase, deadlines and the arming predicate, as one record.
 * @param {any} s @param {any} engine the engine view (null pre-adoption) @param {any} committed the committed
 * fold @param {number|null} status the fold-derived lifecycle status (`projected_status`, the projections' own)
 */
export const visible_turn = (s, engine, committed, status) => {
  const view = s?.view ?? null
  return {
    order: engine?.turn_order ?? [],
    active_entity_id: engine?.active_entity_id ?? null,
    active_key: committed.active ?? null,
    // The PRESENTATION clock's actor: the head unacked non-local wave turn. The chain clock is untouched.
    presenting_entity_id: engine?.presenting_entity_id ?? null,
    status,
    phase: phase(s),
    placement: !!engine?.placement,
    placement_cells: engine?.placement_cells ?? { 0: [], 1: [] },
    winner: s?.winner ?? -1,
    is_my_turn: is_my_turn(s),
    // THE HANDOVER (#1808): the chain seat is mine (`is_my_turn`) and the chain has finished resolving the mobs
    // that played into it — the fact every turn surface mounts on.
    playable: turn_playable(s),
    // The state-shaped arming door (edge `busy` excluded — the run store's single-flight is wider than the core's
    // own and stays an edge input until its family migrates).
    input_armed: input_armed(s),
    presenting: presenting(s),
    cast_presenting: cast_presenting(s),
    draining: draining(s),
    // TWO different facts share the name `turn_ordinal` in this tree: `anchor_ordinal` is the core fold's turn
    // ANCHOR (committed), `seed.turn_ordinal` is the CHAIN's turn-seed input. Named apart, once.
    anchor_ordinal: committed.turn_ordinal ?? null,
    turn_number: committed.fighters?.[s?.my_key]?.turn_number ?? 0,
    my_turn_no: s?.my_turn_no ?? 0,
    deadlines: {
      turn_ms: view?.turn_ms ?? 0,
      turn_deadline_ms: s?.turn_deadline_ms ?? view?.turn_deadline_ms ?? 0,
      turn_deadline_fresh: s?.turn_deadline_fresh === true,
      placement_deadline_ms: view?.placement_deadline_ms ?? 0,
      starved: deadline_starved(s),
    },
    seed: {
      world_seed: view?.world_seed ?? null,
      spawn_id: view?.spawn_id ?? null,
      turn_entropy: view?.turn_entropy ?? null,
      turn_ordinal: view?.turn_ordinal ?? null,
    },
  }
}

/**
 * RESULT — the terminal record, in the RESULT RECORD's own vocabulary (#1993 WP4, `result_record.js`): the same
 * `kind`/`winner`/`run` keys, the same `provenance` map, and the same `conflicts` channel the game store's
 * post-teardown half uses. Two homes read one shape, so a surface that upgrades from the live view to the
 * persistent card is reading the same fact under the same name.
 *
 * BUILT THROUGH THE GUARD, not through a precedence ladder. `outcome_winner`'s `chain_terminal ?? decided`
 * ordering is still correct — the settle read outranks the client-knowable inference — but it used to consume
 * the disagreement in silence. Committing chain truth FIRST and offering the decided outcome SECOND yields the
 * identical winner while naming which home answered and, when the two genuinely contradict, keeping the loser's
 * claim as data. `winner` stays -1-free here: null means undecided, and `outcome_winner` is re-exported below
 * unchanged for every caller still on it.
 *
 * DECLINED IN THIS TRAIN — the ACROSS-TIME ratchet. A projection has no memory, so nothing here can stop a
 * later state from answering `null` after an earlier one answered `victory` (a settle read cleared by
 * `pending_settlement`, or a torn snapshot reviving a mob under `decided_outcome`). That ratchet has to live in
 * the fold that owns the evidence — and the evidence is the CORE's committed board, which this presentation
 * fold deliberately cannot see (`fold.js` header, #1027). Moving it is a core-fold change, not a projection
 * one, so it is its own train rather than a drive-by through a boundary this file is not allowed to cross. The
 * loot half of the record IS already ratcheted, in the one place its evidence actually accumulates.
 */
export const visible_result = (s, status) => {
  const chain = chain_terminal_status(s)
  const decided = decided_outcome(s)
  // A landed settle read ANSWERS — including ROOM_CLEARED's answer of "no terminal winner, the room-clear path
  // owns this one". The client-knowable inference commits only in its absence, which is `outcome_winner`'s
  // ordering exactly; what is new is that its claim is not thrown away when the two disagree.
  const answered = chain != null
  const record = answered
    ? commit_fact(
        empty_result(),
        'winner',
        chain === STATUS_WON ? 0 : chain === STATUS_FAILED ? 1 : null,
        'chain_terminal'
      )
    : commit_fact(empty_result(), 'winner', decided, 'decided')
  const contradicted = answered && decided != null && decided !== record.winner
  return {
    ...record,
    conflicts: contradicted
      ? [...record.conflicts, { key: 'winner', held: record.winner, offered: decided, source: 'decided' }]
      : record.conflicts,
    kind:
      chain === STATUS_ROOM_CLEARED
        ? 'room_clear'
        : record.winner === 0
          ? 'victory'
          : record.winner === 1
            ? 'defeat'
            : null,
    chain_terminal_status: chain,
    decided,
    status,
    is_over: is_over(s),
    settlement_request: settlement_request(s),
  }
}

/**
 * SYNC — the fight-health verdict: is the board here, does the turn clock resolve to a real fighter, and how far
 * has truth outrun the eye. The chip surfaces derive these ad-hoc today; the pacing posture is `project_hud`'s,
 * called (never re-derived) and guarded so a partial/hand-built state reads null rather than throwing.
 */
export const visible_sync = (s, active_entity_id, entities) => {
  const hud = s?.core?.inbox && s?.core?.clock ? project_hud(s.core) : null
  return {
    // An ACTIVE fight has no actionable turn until its actor resolves to a real row.
    actor_unresolved: active_entity_id == null || entities[active_entity_id] == null,
    board_adopted: s?.view != null,
    starved: deadline_starved(s),
    presenting: presenting(s),
    truth_version: hud?.truth_version ?? null,
    lag_beats: hud?.lag_beats ?? null,
    snapping: hud?.snapping ?? false,
    failures: hud?.failures ?? 0,
  }
}

/** MOUNT — fight presence, session mode, and who the viewer is inside it. */
export const visible_mount = (s, engine) => {
  const fight_id = s?.core?.fight_id ?? null
  const scope = session_scope(fight_id)
  const adopted = s?.view != null
  return {
    fight_id,
    scope,
    adopted,
    world_active: adopted && scope === 'world',
    sim_active: adopted && scope === 'sim',
    viewer: {
      my_key: s?.my_key ?? null,
      my_entity_id: engine?.my_entity_id ?? null,
      controlled_entity_ids: engine?.controlled_entity_ids ?? [],
      address: s?.ctx?.address ?? null,
      spectator: s?.ctx?.spectator === true,
    },
  }
}

/** One turn-control phase verdict — the actor resolved THROUGH the entity rows (an id without a row is a
 *  transient/incoherent turn, never a playable one), exactly like the input gate. A chain seat the turn has NOT
 *  been handed over on yet is 'waiting', not 'armed' (#1808): the control the player is looking at says it is
 *  waiting rather than offering a turn it will then take back. */
const turn_control_phase = (engine, active_entity_id, entities, busy, playable) => {
  const me = engine?.my_entity_id ?? null
  const active = active_entity_id ? entities[active_entity_id] : null
  if (!engine || engine.spectator || engine.winner !== -1 || me == null || active == null) return 'hidden'
  if (active.id !== me) return 'waiting'
  if (!playable) return 'waiting'
  return turn_input_armed(true, busy, false) ? 'armed' : 'committing'
}

/** The chain slot my NEXT action folds with (actions.move: `participant::casts_this_turn` at its execution),
 *  read off the live fold: the snapshot row as base, the ordered post-view tail as the correction. Receipt and
 *  intent casts both precede the NEXT appended action; weapon strikes are Casts in this log too. THE read every
 *  seeded preview shares — the move wash's tackle contest, the §7 crit clock, the socket glow (#1224) — so a
 *  preview and the roll it previews can never price different slots. A scalar by design. Null when there is no
 *  seat to price. `ahead` counts actions of a PLANNED batch that exist in no journal yet (the bot's bank).
 *  Lives HERE (moved out of project.js, which re-exports it verbatim) because the CONTROLS record carries it:
 *  a React surface reads `controls.action_slot` through the view's door, never a raw-core selector.
 *  @param {any} s the fight store state @param {{ ahead?: number }} [opts] */
export const my_action_slot = (s, { ahead = 0 } = {}) => {
  const seat = Number(String(s?.my_key ?? '').slice(1))
  const row = Number.isInteger(seat) ? s?.view?.escrow?.[seat] : null
  return row ? next_action_slot({ base: row.casts_this_turn, events: s.log, seat, ahead }) : null
}

/** CONTROLS — the min-turn floor, tx flight, the draft, the next action slot, and the END-TURN control's phase. */
export const visible_controls = (s, engine, active_entity_id, entities) => ({
  // The CORE's own commit-flight flag. The run store's `busy` is wider (engage/place/settle) and remains an
  // edge input the consumer ANDs in — the same split `input_armed` already documents.
  busy: !!s?.busy,
  commit_due: commit_due(s),
  draft_count: s?.staged?.length ?? 0,
  // THE NEXT ACTION SLOT (#1224's one home) — the §7 seeded previews (socket glow, target prediction) price
  // their roll on this scalar, so they read it from the record rather than subscribing to a raw-core selector.
  action_slot: my_action_slot(s),
  // THE min-turn floor as an ABSOLUTE INSTANT, never a remaining-ms (a `now` reading would make this view impure
  // and its memoized value a lie). `min_turn_left(state, now)` is that subtraction, unchanged.
  min_turn_ready_at: min_turn_ready_at(s),
  // The state-only half of `can_end_turn`: my turn, fight live. The floor above completes it at read time.
  end_turn_eligible: is_my_turn(s) && !is_over(s),
  // The END-TURN control's 3-state, derived with the CORE busy (see `busy` above): 'hidden' when there is no
  // live actor, 'waiting' when the turn is someone else's OR not yet handed to me, else armed/committing.
  phase: turn_control_phase(engine, active_entity_id, entities, !!s?.busy, turn_playable(s)),
})
