// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD FIGHT — the two overworld entry points (ENTER create-handoff · RESUME reconnect) for a BARE on-chain Fight
// (no RunPass); the SAME store + core play/settle it (`run_pass_id: null`). `dungeon_id`=fight id; `in_session`=false.
//
// #1609 — THE PENDING SESSION. A create transaction takes ~6.5s to finalize, and until it did the session had no
// identity at all, so the player pressed ATTACK and watched a dead screen. The board, however, is derivable at
// the click: `board::generate_for_anchor`'s deterministic twin folds (world_seed, anchor) into the exact layout
// the chain is about to store. So the session mounts IMMEDIATELY under a synthetic pending id and RE-KEYS to the
// minted object id at finality — ONE pure transition, no second board, no second render path. Three laws hold it:
//   · the pending id is branded (`pending:<uuid>`, never 0x-hex) and every SDK write door refuses it mechanically
//     (@aresrpg/sdk/pending_fight_id) — a settle/PTB attempt against it is a typed error, not a doomed tx;
//   · a pending session reads NOTHING (no poll, no SSE, no receipt walk) — there is no journal before finality,
//     so it renders the predicted fold ALONE; the wire is linked at re-key, by the same activation path a resume
//     has always used;
//   · a failed/aborted create KILLS it cleanly (`abandon_pending_world_fight`) — no latch, no trap state, nothing
//     settleable survives.
// The prediction is deliberately GEOMETRY ONLY. The board is a byte-exact twin (fixture-pinned in
// packages/sim/test/board_gen.test.js); seats and mob cells are NOT (mob_placement.js says so in its own header),
// so they arrive with chain truth and the reconcile is purely additive — a fighter appearing, never a correction.

import { generate_for_anchor } from '@aresrpg/sim/board_gen'
import { fight_store } from '@aresrpg/fight/store'
import { new_pending_fight_id } from '@aresrpg/sdk/pending_fight_id'

import { use_auth } from '../auth'
import { get_fights } from '../rpc/client'
import { game_log } from '../core/log.js'
import i18n from '../i18n'
import { push_event_toast } from '../game/core/toast.js'

import { use_dungeon } from './dungeon_store.js'
import { use_party } from './party_store.js'
import { abandon_fight } from './dungeon_actions'
import { offer_fight_resume } from './fight_resume_offer.js'
import { fight_state_trace } from './fight_state_trace.js'
import { poll_receipt_fight, receipt_entry_decision } from './world_fight_receipt.js'
import { init_dungeon_fight } from './dungeon_fight_shim.js'
import { ensure_resumable_fight } from './fight-liquidation.js'

const { getState } = use_dungeon
/** True while a fight/dungeon session already owns the shared store (never stomp a live board). */
const session_busy = () => getState().fight_id != null || getState().run_pass_id != null
/** A resume reads for SECONDS (two /v1 hops + a chain read + a liquidation door); a player can engage a whole
 *  new fight inside that window. `resume_world_fight` only ever starts from an EMPTY store (its own entry gate),
 *  so ANY session standing here now is younger than this pass's reads: this candidate is stale and owns nothing —
 *  neither a mount nor a recovery. Traced, never silent (#1645). @param {string} fight_id the stale candidate */
const resume_superseded = (fight_id) => {
  if (!session_busy()) return false
  fight_state_trace('fight_resume_validation_superseded', {
    candidate_fight_id: fight_id,
    current_fight_id: getState().fight_id,
  })
  return true
}
const is_live = (f) => !!f && (f.status === 'placement' || f.status === 'active') // the two hostable statuses
const ENGINE_PLACEMENT = 0 // fight.move status — the window a freshly created Fight opens in

/**
 * THE PREDICTED FIGHT — a decoded-Fight-shaped record carrying the board the create is about to mint, and
 * nothing else. PURE. `null` whenever an input is missing: a session with no prediction mounts blank exactly as
 * it did before, which is the honest degradation (never a fabricated board).
 * @param {{ pending_id:string, world_id:string, world_seed:number|bigint|null|undefined,
 *   anchor_x:number, anchor_z:number }} args
 */
export function predicted_world_fight({ pending_id, world_id, world_seed, anchor_x, anchor_z }) {
  const x = Math.trunc(Number(anchor_x))
  const z = Math.trunc(Number(anchor_z))
  if (!pending_id || world_seed == null || !Number.isFinite(x) || !Number.isFinite(z)) return null
  const board = generate_for_anchor(world_seed, x, z)
  return {
    id: pending_id,
    world: world_id ?? null,
    world_seed: BigInt(world_seed),
    anchor_x: x,
    anchor_z: z,
    status: ENGINE_PLACEMENT,
    width: board.width,
    height: board.height,
    shape_mask: board.shape_mask,
    obstacles: board.obstacles,
    holes: board.holes,
    start_cells_a: board.start_cells_a,
    start_cells_b: board.start_cells_b,
    // NOT predicted — chain truth fills these at finality. An empty roster is the honest "not known yet".
    participants: [],
    mobs: [],
    queue: [],
    turn_ptr: 0,
    turn_deadline_ms: 0n,
    placement_deadline_ms: 0n,
    last_action_ms: 0n,
  }
}

/** ENTER: publish the minted id as a run-pass-LESS session, OPEN it in the core, start the poll (idempotent; a live
 *  session is never stomped; `resumed` suppresses the cinematic). `is_public` gates the owned-party auto-form: a
 *  PUBLIC fight discards the party id, so forming one is a wasted create tx (defaults false — form, for every
 *  non-engage entry that stays on today's behavior). `world_group` is the claimed group's identity
 *  ({world_id,zx,zy,index}) carried straight out of the claim — the session FACT a lost fight gives back (#609);
 *  a resume has no claim to carry one, and releases nothing.
 *  `mob_roster` is the claimed group's already-composed world identity, carried by stable fighter id into the
 *  fight reducer; a reconnect/join without that local fact keeps the normal adoption fallback.
 *  @param {{fight_id,world_id?,character_id,resumed?,is_public?,world_group?,mob_roster?}} */
export function enter_world_fight({
  fight_id,
  world_id = null,
  character_id,
  resumed = false,
  is_public = false,
  world_group = null,
  mob_roster = [],
}) {
  if (!mount_world_fight({ fight_id, world_id, character_id, resumed, world_group, mob_roster })) return
  activate_world_fight({ fight_id, resumed, is_public })
}

/**
 * MOUNT — the ONE render home. Publishes the session into the shared store and OPENS it in the core; a
 * `predicted` record additionally folds through the core's ONE snapshot door, so a pending board and a chain
 * board reach the renderer down the identical path (there is no second surface to keep in sync). Returns false
 * when the entry decision refused (invalid / same id / another session live).
 * @param {{fight_id:string, world_id?:string|null, character_id:string, resumed?:boolean,
 *   world_group?:any, mob_roster?:any[], predicted?:any}} args
 */
function mount_world_fight({
  fight_id,
  world_id = null,
  character_id,
  resumed = false,
  world_group = null,
  mob_roster = [],
  predicted = null,
}) {
  const store = getState()
  const decision = receipt_entry_decision({
    current_fight_id: store.fight_id,
    current_run_pass_id: store.run_pass_id,
    next_fight_id: fight_id,
    character_id,
  })
  fight_state_trace('fight_create_adopt', { fight_id, character_id, resumed, decision })
  if (decision === 'invalid' || decision === 'same') return false // same receipt id enriches the existing mount
  if (decision === 'busy') {
    game_log('world-fight', 'enter refused — a session is already live', { have: store.fight_id })
    return false
  }
  const { address } = use_auth.getState()
  use_dungeon.setState({
    fight_id,
    fight_fresh: !resumed, // fresh create vs reload-resume — the entry cinematic gates on this stamp
    dungeon_id: fight_id, // the session identity → GameWorldHud in_dungeon stays true (no dead WS chrome)
    world_id,
    // #609 — WHICH group this fight took, held for the whole session: settlement is the only place it can be
    // given back, and by then the claim is long over. Null once the session ends (reset clears it).
    world_group,
    template_id: world_id,
    character_id,
    run_pass_id: null, // a world fight has no RunPass — refresh()/settle take their world (no-run) branches
    run: null,
    rooms: [], // no dungeon rooms → the core resolves victory as terminal WON (not ROOM_CLEARED)
    result_id: null,
    phase: 'playing',
    error: null,
    fight_syncing: !resumed, // create/join receipt truth outranks a temporarily-missing serving-node read
    spectating: false,
    session_address: address,
  })
  init_dungeon_fight({ fight_id, character_id, address, mob_roster }) // OPEN it in the core (refresh feeds snapshot)
  // The PREDICTED board through the core's ONE snapshot door at version 0 — the same door every chain read
  // uses, so the renderer never learns this board came from a fold instead of a node. The first real read
  // arrives at the Fight object's version (≥ 1) and adopts over it by the reducer's ordinary versioned merge.
  if (predicted)
    fight_store.getState().input({ type: 'snapshot', fight: predicted, fight_id: predicted.id, version: 0 })
  fight_state_trace('fight_create_published', { fight_id, character_id, resumed, fight_syncing: !resumed })
  return true
}

/**
 * ACTIVATE — the reads. Starts the store heartbeat (which owns the SSE link) and the receipt-convergence walk,
 * and auto-forms the owned party. A pending session never reaches here: there is no journal to read before its
 * create finalizes, so the wire is linked by `rekey_world_fight` at the moment the id becomes real.
 * @param {{fight_id:string, resumed?:boolean, is_public?:boolean}} args
 */
function activate_world_fight({ fight_id, resumed = false, is_public = false }) {
  getState()._start_polling()
  if (resumed) return void getState().refresh()
  // Auto-form the owned party at engagement; the GROUP LOOP (group_wiring → @aresrpg/party group_loop)
  // watches this fight's placement window and seats every aligned owned member exactly once — the join
  // decision left this file (one home: the reducer; the per-member tx stays owned_team_actions). A PUBLIC
  // fight carries no party id (anyone may join), so forming one here is a discarded on-chain create tx — skip it.
  if (!is_public)
    void use_party
      .getState()
      .ensure_owned_party()
      .catch((error) => game_log('world-fight', 'owned party auto-form stopped', error))
  void poll_receipt_fight({ fight_id, get_state: getState, refresh: () => getState().refresh() }).then((outcome) => {
    // The tight backoff loop gave up at its wait ceiling — never a silent stop: the slower 4s heartbeat
    // (_start_polling, already running) is the one still converging it, traced here for visibility.
    if (outcome === 'timed_out')
      game_log('world-fight', 'receipt poll hit its wait ceiling — the 4s heartbeat keeps trying', { fight_id })
  })
}

// ╔════════════════ [ #1609 — the pending session: mount at submit, re-key at finality ] ══════════ ]

/**
 * MOUNT a world fight under a fresh pending id, rendering the predicted board in the caller's own turn. Returns
 * the pending id the caller must carry to `rekey_world_fight` (finality) or `abandon_pending_world_fight`
 * (failure) — null when the mount refused, in which case the caller simply behaves as it did before this row.
 * NOTHING is read here: a pending session has no chain identity, so it has nothing to poll for.
 * @param {{ world_id:string|null, character_id:string, world_seed:number|bigint|null|undefined,
 *   anchor_x:number, anchor_z:number, world_group?:any, mob_roster?:any[] }} args
 */
export function enter_pending_world_fight({
  world_id = null,
  character_id,
  world_seed,
  anchor_x,
  anchor_z,
  world_group = null,
  mob_roster = [],
}) {
  const pending_id = new_pending_fight_id()
  const predicted = predicted_world_fight({ pending_id, world_id, world_seed, anchor_x, anchor_z })
  if (!predicted) {
    // No seed / no anchor ⇒ no honest prediction. Say so and let the receipt path mount as it always has.
    game_log('world-fight', 'no predicted board for this engage — mounting at finality', { world_id, anchor_x })
    return null
  }
  const mounted = mount_world_fight({
    fight_id: pending_id,
    world_id,
    character_id,
    world_group,
    mob_roster,
    predicted,
  })
  if (!mounted) return null
  fight_state_trace('fight_pending_mounted', { pending_id, world_id, character_id })
  return pending_id
}

/**
 * RE-KEY a pending session onto the id its create receipt minted — ONE transition, both identity homes (the
 * shared store's `fight_id`/`dungeon_id` and the fight core's own, through its ONE input door). The predicted
 * board, the ctx and the seat all survive; only the name moves. The reads start HERE, by the same activation
 * every other entry uses. Returns false when this session is no longer the pending one (a stale receipt).
 * `world_group` is the #609 claim fact only the receipt knows (which group a defeat gives back) — it is stamped
 * HERE, in the same transition, so it is present before any settlement can possibly run.
 * @param {string} pending_id @param {string} fight_id
 * @param {{ is_public?:boolean, world_group?:any }} [opts]
 */
export function rekey_world_fight(pending_id, fight_id, { is_public = false, world_group = null } = {}) {
  if (!pending_id || !fight_id || getState().fight_id !== pending_id) {
    fight_state_trace('fight_pending_rekey_stale', { pending_id, fight_id, have: getState().fight_id })
    return false
  }
  use_dungeon.setState({ fight_id, dungeon_id: fight_id, world_group })
  fight_store.getState().input({ type: 'rekey', from: pending_id, to: fight_id })
  fight_state_trace('fight_pending_rekeyed', { pending_id, fight_id })
  activate_world_fight({ fight_id, is_public })
  return true
}

/**
 * KILL a pending session whose create failed or aborted — THE SAD-PATH INVARIANT. A pending id is settleable by
 * nothing (every write door refuses it), so the only thing that could survive is the mount itself: close the
 * core session, drop the store's local session state, and the player is back in the world with no latch, no
 * ghost board and no trap state. Idempotent; a session that already moved on is left alone.
 * @param {string|null} pending_id
 */
export function abandon_pending_world_fight(pending_id) {
  if (!pending_id || getState().fight_id !== pending_id) return false
  getState().reset_local() // stops the (never started) poll, closes the core session, drops every session latch
  fight_state_trace('fight_pending_abandoned', { pending_id })
  return true
}

/**
 * WATCH a public active world fight without taking a seat. This is the same read/poll/journal session as a
 * participant resume, but its core context has no wallet/character identity and is explicitly spectator-only.
 * Returns false when the request is not public/live-shaped or another fight/run already owns the shared store.
 * @param {{ fight_id:string, world_id?:string|null, public_fight?:boolean, status?:string|null }} args
 */
export function spectate_world_fight({ fight_id, world_id = null, public_fight = false, status = null }) {
  if (!fight_id || !public_fight || status !== 'active' || session_busy()) return false
  const { address } = use_auth.getState()
  use_dungeon.setState({
    fight_id,
    fight_fresh: false,
    dungeon_id: fight_id,
    world_id,
    template_id: world_id,
    character_id: null,
    run_pass_id: null,
    run: null,
    rooms: [],
    result_id: null,
    phase: 'playing',
    error: null,
    fight_syncing: true,
    spectating: true,
    session_address: address,
  })
  // Null address is intentional: engine_view otherwise adopts the first seat owned by this wallet even when the
  // requested character is null. The spectator marker drives read-only projection while the null seat keeps the
  // core provider idle.
  init_dungeon_fight({ fight_id, character_id: null, address: null, spectator: true })
  getState()._start_polling()
  void getState().refresh()
  return true
}

/**
 * THE FORFEIT half of the resume door (#1751): the player chose to leave the seat behind. `actions::abandon` is the
 * same door the mounted board's forfeit button presses — a death inside the fight, so ordinary settlement still
 * runs. A tx that does NOT land leaves the seat exactly as it was and says so: the character reference is only
 * recovered on a real digest, never on hope (a silent recovery would strand the outcome).
 * @param {string} fight_id @param {string} character_id
 * @param {(fight_id: string, character_id: string, silent: boolean) => Promise<any>} door
 * @returns {Promise<boolean>} did the seat actually get abandoned?
 */
async function forfeit_resumed_fight(fight_id, character_id, door) {
  try {
    await door(fight_id, character_id, true)
    fight_state_trace('fight_resume_forfeited', { fight_id, character_id })
    return true
  } catch (error) {
    console.error(`[world-fight] forfeit of ${fight_id} did not land — the seat is untouched`, error)
    game_log('world-fight', 'resume forfeit failed — seat untouched', { fight_id })
    return false
  }
}

/** RESUME after a reload: discover the candidate, then validate it is still live BEFORE entry (absent/terminal
 *  stays in-world; a transient read holds for a later boot pass). EVERY candidate then passes the chain-truth
 *  presentability gate (fight-liquidation.js — the REJOIN-SPAWN root, widened by #882): an expired placement
 *  window liquidates via `force_start` and an expired TURN via `crank` BEFORE adoption, and a fight those doors
 *  resolved terminal routes back to the world with an honest toast instead of re-capturing the character.
 *
 *  THE DOOR (#1751/#1757): those liquidation transactions are real gas and a real move of the fight's lifecycle,
 *  and a boot used to send one per pass with no player action at all (measured five-for-five, and the mechanism
 *  that resolved a stranded seat as a DEFEAT nobody chose). So an entry onto a chain-live seat this client is not
 *  mounting now ASKS — rejoin or forfeit — and commits nothing until that answer arrives. A seat inside its
 *  deadline is unaffected: it needs no transaction, so it mounts straight away exactly as before.
 *  @param {string} character_id
 *  @param {{ force_start_door?: Function, crank_door?: Function, forfeit_door?: Function,
 *    consent?: (ask: { fight_id: string, action: string, deadline: number }) => Promise<string> | string,
 *    is_current?: () => boolean }} [deps] unit seam only — `consent` lets a test that is measuring the
 *    LIQUIDATION mechanics answer the door directly instead of driving the dialog store */
export async function resume_world_fight(character_id, deps = {}) {
  const is_current = deps.is_current ?? (() => true)
  if (!character_id || !is_current() || session_busy()) return
  let fights
  try {
    fights = await get_fights({ character: character_id })
  } catch (error) {
    return game_log('world-fight', 'resume read failed — no reconnect this pass', error)
  }
  if (!is_current()) return
  const live = (fights ?? []).find(is_live)
  const fight_id = live?.fight_id ?? live?.fight
  if (!fight_id) return // nothing resumable — stay in the world
  let current
  try {
    current = (await get_fights({ id: fight_id })).find((f) => (f.fight_id ?? f.fight) === fight_id && is_live(f))
  } catch (error) {
    return game_log('world-fight', 'resume liveness read failed — staying in the world', error)
  }
  if (!is_current()) return
  if (!current) {
    if (resume_superseded(fight_id)) return
    return getState()._recover_dead_fight_reference({ character_id, state: 'absent' })
  }
  // ONE chain-truth gate for both live statuses (#882): expired placement → force_start, expired turn → crank,
  // and whatever the chain reports AFTER that door decides. `gone` = the door resolved it terminal (or it was
  // destroyed): route out honestly — the character is freed and its outcome recovered, never re-captured.
  const { decision, reason, choice } = await ensure_resumable_fight(fight_id, {
    force_start_door: deps.force_start_door,
    crank_door: deps.crank_door,
    // THE DOOR: asked before any transaction is composed, answered by the player (FightResumeOffer.jsx).
    consent:
      deps.consent ??
      (({ action, deadline }) => offer_fight_resume({ fight_id, character_id, action, deadline_ms: deadline })),
  })
  if (!is_current()) return
  if (decision === 'declined') {
    // The player answered, so nothing was sent. 'later' leaves the seat exactly as it is (the next boot asks
    // again); 'forfeit' spends ONE abandon and, only if it landed, frees the character + recovers its outcome.
    if (choice !== 'forfeit') return
    const abandoned = await forfeit_resumed_fight(fight_id, character_id, deps.forfeit_door ?? abandon_fight)
    if (!abandoned || !is_current()) return
    return getState()._recover_dead_fight_reference({ character_id, state: 'settled' })
  }
  if (decision === 'gone') {
    // The recovery below is a FULL local teardown (reset_local) aimed at THIS stale candidate's reference. A
    // session that opened while the door read is not it — tearing it down unmounts a live board the player is
    // standing on (#1645). Guard BEFORE the toast: no recovery, no "your fight was cleared" claim.
    if (resume_superseded(fight_id)) return
    fight_state_trace('fight_resume_expired_gone', { fight_id, character_id, reason })
    push_event_toast({ state: 'info', title: i18n.t('fights.expired_fight_cleared') })
    return getState()._recover_dead_fight_reference({ character_id, state: 'settled' })
  }
  if (decision !== 'enter') {
    // NEVER a silent return (#932): the serving node says this character has a LIVE fight, so declining to
    // re-enter leaves them roaming with a seat on chain. Say so loudly enough to reach a bug report.
    console.error(`[world-fight] resume refused — fight ${fight_id} not re-entered: ${reason}`)
    game_log('world-fight', 'resume refused', { fight_id, reason })
    return
  }
  if (!is_current() || session_busy()) return // a session opened or the request changed while reading — never stomp it
  enter_world_fight({ fight_id, world_id: current.world ?? live.world ?? null, character_id, resumed: true })
}
