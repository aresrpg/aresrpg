// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-57 — the SETTLEMENT CHAIN (extracted from dungeon_store.js for the ≤600-LoC law): the background,
// single-flight sequence that turns a TERMINAL fight into landed spoils. The settle→open GAP is CLOSED — a fresh
// terminal fight settles AND opens in ONE ATOMIC PTB (`settle_and_open`): either the fight deletes, my
// `FightOutcome` is minted+consumed, the `FightResult` mints and the fight_marker CLEARS all together, or NOTHING
// happens (fight stays live, cleanly retriable) — no half-settled brick.
//   settle_and_open [WORLD: settle_and_take → open_taken | DUNGEON: settle_and_take → dungeon::settle_run(&h) →
//   open_taken] → `FightResult` → mint_rolled per rolled template → burn_result.
// The pending-outcome PILL (land_outcome) is the SEPARATE surface for an ALREADY-EXISTING outcome (its Fight was
// destroyed elsewhere — nothing left to settle): it opens via results::open alone / dungeon::settle_run+open.
// LAWS: an EXECUTED failure LATCHES (digest = gas burned — never blindly re-fired); the console is loud, the
// recap/card is the surface (no toasts — every tx below signs silent).

import { get_fight_result } from '@aresrpg/sdk/fight'
import { experience_to_level } from '@aresrpg/sdk/experience'

import { context } from '../game/store.js'
import { get_sdk } from '../chain/sdk'
import { get_template_map } from '../chain/read_findables.js'
import { load_roster } from '../roster/load_roster'
import { note_claimed } from '../fight-engine/fight_end_machine.js'
import { humanize_abort } from '../game/core/abort_copy.js'
import { push_event_toast } from '../game/core/toast.js'
import { use_auth } from '../auth'
import { get_fights, get_dungeon_runs, get_pending_outcomes, get_fight_results } from '../rpc/client'
import i18n from '../i18n'
import { game_log } from '../core/log.js'

import { settle_and_open, settle_run_and_open, open_outcome, mint_all_and_burn } from './dungeon_actions'
import { loot_from_minted_rows, loot_from_rolled } from './fight_result_receipt.js'
import { mint_and_reduce_inventory as reduce_minted_inventory } from './loot_inventory_effect.js'
import { settled_loot_rows } from './loot_inventory.js'
import { apply_fight_receipt } from './store_patch.js'
import {
  pending_outcomes_for,
  invalidate_pending_outcomes,
  begin_attempt,
  end_attempt,
  attempt_state,
  acquire_settlement_flight,
  recover_marked_fight_entry,
  recover_settled_elsewhere,
  run_result_auto_open,
  is_preflight_failure,
  settle_halt_notice,
} from './pending_outcomes.js'
import { run_latched_claim } from './fight_claim_latch.js'
import { settle_verdict } from './fight_settle_confirm.js'
import { read_fight_liveness } from './fight_liveness.js'
import { lost_group_of } from './lost_group.js'
import { character_run_pass_id } from './team_entry.js'
import { enqueue_mint, drain_pending_mints, sweep_stranded_results } from './pending_mints.js'
import { surface_expired_placement_entry_refusal } from './fight_entry_liveness.js'

/** BOUNDED READ-ONLY retry (kiosk_resolve.js's join_kiosk_for_character idiom): the settle+open PTB already
 *  landed, so a null/thrown read is read-after-write lag on the object it just minted, never a tx to retry.
 *  Closes the loot skeleton "stuck forever" gap; a sustained miss still gives up honestly (null, hold-not-invent). */
async function read_result_with_retry(read_once, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await read_once().catch(() => null)
    if (result) return result
    if (attempt < 3) await sleep(1600)
  }
  return null
}

/** SPOILS FLOOR (leg②): ResultOpened names only a total unit COUNT, no per-template identity (that lives
 *  solely in the FightResult `rolled` read below) — the ONE entry the card can honestly render the instant the
 *  event lands. Mirrors loot_from_rolled's D53 degrade shape — resolve_loot_tile.js already renders the letter fallback. */
const floor_loot = (units) => (units > 0 ? [{ item_type: '', name: '', amount: units }] : [])

/** AUTO-FIRE NOTICE (#684 — "it's spamming me with tx"): every background claim/settle names itself BEFORE its
 *  tx builds. ONE shared copy fired at each auto-fire site (the boot sweep's two leaves + the entry-refusal
 *  recovery) — a silent wallet tx with zero UI reads as malware to a player. Best-effort: fires once per
 *  attempted row, same as the dead announce-toast below it corrects a blocked one after the fact. */
const announce_auto_claim = () => push_event_toast({ state: 'info', title: i18n.t('fights.claiming_pending_result') })

/**
 * THE HALT LINE (#1383 ①) — the ONE place a settlement halt speaks, and it speaks a PROJECTION. "You have an
 * unfinished fight result" is a claim about the `/v1/pending-outcomes` row the character-panel badge renders,
 * so it is made only when that row exists; the halt used to push it blind, including on the EXECUTED abort that
 * reverts the whole PTB and mints nothing at all — the live report ("the toast said so, the surface showed
 * nothing"). With no row the honest line is the failure itself. `settle_halt_notice` owns the decision (leaf,
 * unit-driven); this edge only renders it.
 *
 * FIRE-AND-FORGET at both call sites: the halt VERDICT must reach its caller at exactly the speed it always
 * did (the retry engine reads it), and the line can land a beat later, once the projection has answered.
 * @param {string|null} character_id @param {unknown} error the halt's own cause, when there is one
 */
async function surface_settle_halt(character_id, error) {
  const { address } = use_auth.getState()
  const { claim } = await settle_halt_notice(() =>
    address && character_id ? find_pending_outcome(address, character_id) : Promise.resolve(null)
  )
  const title =
    claim === 'pending_result'
      ? i18n.t('errors.fight_unclaimed_result')
      : error
        ? humanize_abort(error)
        : i18n.t('errors.fight_settle_failed')
  push_event_toast({ state: 'error', title })
}

/** Atomic mint+burn effect edge: async chain/template DATA returns as one typed inventory reducer INPUT.
 *  `current_address` is the LIVE use_auth identity (loot_inventory_effect.js's header has the story). */
const mint_and_reduce_inventory = (result_id, templates) =>
  reduce_minted_inventory(result_id, templates, {
    mint_and_burn: mint_all_and_burn,
    load_templates: get_template_map,
    reducer_door: context,
    current_address: () => use_auth.getState().address,
  })

/** The pending-mints queue's deps: the chain-direct FightResult read (mint eligibility = chain truth, never a /v1 answer) + the atomic mint+burn edge, rebuilt per call for the memoized SDK's gRPC client. EXPORTED (#1212):
 *  owned_dungeon_settlement.js's companion tail reuses the SAME deps to enqueue a companion's own opened result —
 *  one home for "how a FightResult owes its mint+burn," never a second composer. */
export const mint_deps = () => ({
  read_result: async (/** @type {string} */ id) => get_fight_result({ grpc_client: (await get_sdk()).grpc_client })(id),
  mint_and_burn: mint_and_reduce_inventory,
})

/**
 * Run the chain against `store` (the use_dungeon zustand store). Single-flight on `_settling`. The chain ids
 * may be passed EXPLICITLY (the terminal claim() SNAPSHOTS them before its scene collapse nulls the session —
 * reading live state there would misroute a run's settle as a world fight and strand the pass); when omitted
 * they fall back to live state (the ROOM_CLEARED background path, where the session is intact).
 *
 * SETTLE+OPEN IN ONE PTB (`settle_and_open`): the fight settles AND opens atomically — no window where the fight
 * is settled but the marker is still set (the old two-tx brick). A halt now means NOTHING landed (the fight is
 * still live, cleanly retriable) OR the Fight was already gone (a racing janitor settled it and minted MY outcome
 * to me — the pending-outcome pill re-fetches /v1 truth and auto-opens it). Never blindly re-fired (latch law).
 * @param {any} store
 * @param {{ terminal: boolean, fight_id?: string|null, run_pass_id?: string|null, world_id?: string|null,
 *           character_id?: string|null, lost?: boolean }} args `lost` = this terminal is a DEFEAT, which
 *   releases the claimed mob group back into the world (#609). character_id is REQUIRED for the open leg (`open` kiosk-borrows it) —
 *   snapshot it explicitly on the terminal/recovery paths where the live session is being torn down or never mounted.
 * @returns {Promise<boolean>} true once the composed settle+open landed (the character's fight_marker is CLEARED);
 *   false on any halt (re-entrant, no fight, settle+open failed) — the recovery surface reads this to know it un-bricked.
 */
export async function settle_chain(store, { terminal, on_halt, on_settled, lost = false, ...ids }) {
  const { getState, setState } = store
  // #1223 ③: set on a PRE-FLIGHT halt (zero gas — the Fight was already gone, so MY outcome exists unopened).
  // Drained in the `finally`, AFTER the `_settling` flight releases: the open must acquire that same flight.
  let strand = null
  if (getState()._settling) return false
  const state = getState()
  const fight_id = ids.fight_id ?? state.fight_id
  const run_pass_id = ids.run_pass_id ?? state.run_pass_id
  const world_id = ids.world_id ?? state.world_id
  // open kiosk-borrows THIS character (XP/HP write-back + fight_marker::clear), so the open leg must resolve the
  // kiosk that HOLDS it — never kiosk[0]. Snapshot beats live state: recovery has no live session and the terminal
  // collapse tears the store down while this runs in the background.
  const character_id = ids.character_id ?? state.character_id
  if (!fight_id) return false
  setState({ _settling: true })
  const room = state.dungeon?.room_index ?? 0
  try {
    let result_id = null
    let xp_share = null
    let loot_units = null
    let final_hp = null
    try {
      const opened = await settle_and_open({
        fight_id,
        run_pass_id,
        world_id,
        character_id,
        // #609 — a DEFEAT gives its claimed group back in this same PTB. The group is a session fact recorded
        // at the claim (world_fight/dungeon_run_store); by settlement the claim is long gone.
        lost_group: lost_group_of({ lost, run_pass_id, world_group: state.world_group }),
      })
      ;({ result_id, xp_share, loot_units, final_hp } = opened)
      // SETTLE HONESTY (#882 — settled=true while the chain object lived): a resolved tx is not, by itself, a
      // settled fight. The `ResultOpened` result id IS the chain's own proof; without it the ONLY honest
      // confirmation is a liveness re-read that no longer finds a LIVE Fight. Unconfirmed ⇒ report the halt,
      // never a settlement (fight_settle_confirm.js owns the rule; the read costs nothing on the proven path).
      const verdict = await settle_verdict({
        fight_id,
        result_id,
        read_liveness: async (id) => read_fight_liveness(await get_sdk(), id),
      })
      if (!verdict.settled) {
        game_log('dungeon', 'settle+open landed with NO chain confirmation — reporting unsettled', { fight_id })
        invalidate_pending_outcomes() // whatever this tx did, /v1 truth (not this client) owns the next step
        void surface_settle_halt(character_id, null).catch(() => {}) // the line the FRESH projection can back
        on_halt?.(verdict.halt) // executed: gas was spent, so the latch holds — never an automatic re-fire
        return false
      }
      // The active receipt also proves every same-wallet companion outcome. A caller-supplied lane may advance
      // those distinct RunPasses now; its failure must never relabel this already-landed leader settlement as a
      // failed/retriable leader tx.
      if (on_settled)
        try {
          await on_settled({ receipt: opened.receipt })
        } catch (error) {
          game_log('dungeon', 'owned companion settlement halted after leader receipt (never auto-retried):', error)
        }
    } catch (error) {
      // ATOMIC: the composed settle+open either landed WHOLE or changed nothing — there is no half-settled brick.
      // A PRE-FLIGHT failure means the Fight was already gone (a racing janitor's settle_and_destroy minted MY
      // outcome to me): `strand` below re-reads /v1 truth and opens it on the spot (#1223 ③ — this used to wait
      // for a reload or the next abort-111 engage). An EXECUTED abort rolled the whole PTB back (fight still
      // live, retriable). NEVER blindly re-fired (latch law) — loud + re-arm the pill + stop.
      game_log(
        'dungeon',
        'settle+open failed (raced-gone or executed abort) — settlement halted:',
        humanize_abort(error?.message ?? String(error))
      )
      const preflight = is_preflight_failure(error)
      // #1223 ③: a PRE-FLIGHT halt is not a dead end any more — it PROVES the racing settle minted my outcome, and
      // the drain below opens it right now. Only an EXECUTED halt (gas burned, fight still live, never re-fired)
      // still tells the player to go press the pill themselves.
      invalidate_pending_outcomes() // a racing janitor may have minted MY outcome — the pill re-fetches truth
      if (!preflight) void surface_settle_halt(character_id, error).catch(() => {}) // one line, backed by truth
      on_halt?.(preflight ? 'transient' : 'executed_failure')
      if (preflight) strand = { character_id, fight_id }
      return false
    }
    setState({ fight_id: null })
    // The open leg landed → the marker is CLEARED. Land the loot off the minted FightResult — the SHARED post-open
    // leg (also the pill's tail). A null result_id (receipt-parse miss) no-ops the loot leg but still repaints.
    // loot_units (the ResultOpened rolled count) rides along so the card renders that many loot skeletons.
    await finish_result(store, { result_id, xp_share, loot_units, final_hp, character_id, terminal, room })
    return true
  } finally {
    setState({ _settling: false })
    // FIRE-AND-FORGET (#1223 ③), after the flight released — the open re-acquires it. The caller already has its
    // own verdict (false); this owns the strand's surface from here.
    if (strand)
      void open_settled_elsewhere(store, strand).catch((error) =>
        game_log('dungeon', 'settle-observed auto-open crashed (the roster pill still owns the manual open):', error)
      )
  }
}

/**
 * THE SETTLE-OBSERVED AUTO-OPEN (#1223 ruling ③ — "the client composes a sponsored fire-and-forget open the
 * moment settle is observed"). A pre-flight settle halt proves someone else's settle destroyed the Fight and
 * minted MY unopened `FightOutcome`; nothing looked again until a reload or the next abort-111 engage. Rides the
 * pill's whole rails: `open_pending_row` owns the per-outcome single-flight + burn-law latch, and its tx takes
 * the ordinary `run_character_action` door (sponsor-first for a zkLogin wallet — tx/sponsor_route.ts), so the
 * spend guard binds it like any automated submission. Never throws; never silent (info beat, then a loud toast).
 * @param {any} store @param {{ character_id: string|null, fight_id: string|null }} strand
 */
async function open_settled_elsewhere(store, { character_id, fight_id }) {
  const { address } = use_auth.getState()
  if (!address || !character_id) return
  const verdict = await recover_settled_elsewhere('transient', {
    // The boot memo predates the racing settle → one fresh /v1 read (the registry still coalesces a live flight).
    find_result: async () => {
      invalidate_pending_outcomes()
      return find_pending_outcome(address, character_id)
    },
    announce: () => push_event_toast({ state: 'info', title: i18n.t('errors.fight_result_opening') }),
    open_result: (row) =>
      open_pending_row(store, address, character_id, row, {
        allow_run_bound: true, // the settle we just lost carried the run leg; the open composes the same one
        live_world_fight_id: fight_id, // that fight id is still in the store and is DEAD — not a live session
        surface_failure: false, // ONE failure home: the honest toast below
      }),
  })
  if (verdict.status !== 'failed') return
  game_log('dungeon', 'settle-observed auto-open failed — the roster pill is the manual fallback:', verdict.error)
  push_event_toast({
    state: 'error',
    title: verdict.error ? humanize_abort(verdict.error) : i18n.t('errors.fight_result_latched'),
  })
}

/**
 * Auto-fire settlement under the shared per-fight failure latch. The first executed failure permanently blocks
 * another automatic attempt this session; only positively classified network/preflight failures re-arm. The
 * roster chip remains the user-initiated fallback and may call raw settle_chain from its manual press.
 */
export async function settle_chain_latched(store, args, { manual = false } = {}) {
  const attempt_id = args?.fight_id ?? store.getState().fight_id
  return run_latched_claim({
    attempt_id,
    manual,
    begin: begin_attempt,
    end: end_attempt,
    run: (note_failure) => settle_chain(store, { ...args, on_halt: note_failure }),
  })
}

/**
 * The pending-outcome OPEN leg (the PILL surface): open an ALREADY-EXISTING `FightOutcome` whose Fight was
 * DESTROYED elsewhere/earlier — [dungeon::settle_run + results::open in ONE PTB | results::open alone] — then land
 * the loot via the shared `finish_result` tail. DISTINCT from settle_chain's `settle_and_open` (which settles a
 * still-LIVE terminal fight): here there is no Fight left to settle, only an outcome to open. The CALLER owns the
 * `_settling` single-flight. `summary_toast` fires the auto-open success beat (07-10).
 * @param {any} store
 * @param {{ outcome_id: string, run_pass_id?: string|null, world_id?: string|null, character_id: string|null,
 *           terminal: boolean, room?: number, summary_toast?: boolean, surface_failure?: boolean,
 *           automated?: boolean }} args `automated` — a WIRE fired this open, not a press: the submission
 *   becomes the spend guard's subject, so an executed failure retires that outcome mechanically (#1383 ②).
 * @returns {Promise<{ landed: boolean, preflight?: boolean, receipt?:any, error?:unknown }>} landed=true once
 *   `results::open` landed (the character's fight_marker is CLEARED); on failure `preflight` classifies it.
 */
async function land_outcome(
  store,
  {
    outcome_id,
    run_pass_id = null,
    world_id = null,
    character_id,
    terminal,
    room = 0,
    summary_toast = false,
    surface_failure = true,
    automated = false,
  }
) {
  let receipt = null
  let result_id = null
  let xp_share = null
  let loot_units = null
  let final_hp = null
  try {
    ;({ receipt, result_id, xp_share, loot_units, final_hp } = run_pass_id
      ? await settle_run_and_open({ run_pass_id, outcome_id, world_id, character_id, automated })
      : await open_outcome(outcome_id, character_id, { automated }))
  } catch (error) {
    // results::open is where fight_marker::clear fires (the ONLY discharge). A failure here leaves the
    // character MARKED with an unopened outcome → abort 111 on the next fight. NEVER silent, NEVER auto-retried
    // (executed-abort burn law) — the classifier below tells the caller whether a digest could exist.
    game_log(
      'dungeon',
      'results::open failed — character still MARKED (the roster pill is the manual fallback):',
      humanize_abort(error)
    )
    if (surface_failure) push_event_toast({ state: 'error', title: humanize_abort(error) })
    invalidate_pending_outcomes() // an unopened outcome now (still) exists — the pill re-fetches truth
    return { landed: false, preflight: is_preflight_failure(error), error }
  }
  // The receipt already proves the marker clear. Finish the old result's display tail before a new fight mounts
  // (its delayed loot reads are not result-keyed), but never let non-authoritative hydration reject that receipt.
  await finish_result(store, {
    result_id,
    xp_share,
    loot_units,
    final_hp,
    character_id,
    terminal,
    room,
    summary_toast,
  }).catch((error) => game_log('dungeon', 'post-open result hydration failed after receipt:', humanize_abort(error)))
  return { landed: true, receipt } // open landed → the marker is CLEARED (the pill surface reads this)
}

/**
 * The loot-landing TAIL shared by settle_chain (composed settle+open) and land_outcome (the pill): once
 * `results::open` has landed (fight_marker CLEARED, `FightResult` minted), mint every rolled template the result
 * owes then burn it for the rebate ONLY once every mint actually landed (results.move:170 aborts 105 ENotEmpty
 * while `rolled` is non-empty — a single failed mint means NO burn is attempted at all, same as a null result_id),
 * and repaint (roster + live view). A null/absent result_id (receipt-parse miss) no-ops the loot leg but STILL
 * repaints — the marker cleared regardless. `summary_toast` fires the auto-open success beat (07-10: one
 * honest XP/loot summary). Never throws (loot failures are logged, not surfaced — the card / mint_loot retry
 * surface owns them).
 * @param {any} store
 * @param {{ result_id: string|null, xp_share?: number|null, character_id?: string|null, terminal: boolean,
 *           room?: number, summary_toast?: boolean }} args xp_share/character_id ride from the open receipt's
 *   ResultOpened event (opened_result_of — the ONE parse home) so the card renders event truth even when the
 *   follow-up object read degrades.
 */
async function finish_result(
  store,
  {
    result_id,
    xp_share = null,
    loot_units = null,
    final_hp = null,
    character_id = null,
    terminal,
    room = 0,
    summary_toast = false,
  }
) {
  const { getState, setState } = store
  setState({ result_id })
  note_claimed()
  if (result_id) context.dispatch('action/fight_result/bind', { result_id })
  // mint EVERY rolled template the result owes AND burn for the rebate — ATOMICALLY, in ONE PTB (below).
  let item_qty = 0
  // LOOT-SKELETON COUNT (07-11): loot_units sizes the pulsing-placeholder count until items hydrate.
  // Event first, FightResult total as fallback. A genuine ZERO stays the NUMBER 0 — never `|| null` (
  // 07-12: `0 || null` once collapsed a real zero into "unknown," leaving the reducer's `??` keep a stale count).
  let rolled_units = Number(loot_units ?? 0)
  // XP: the receipt's ResultOpened event is the PRIMARY truth (ground truth 07-11: the chain pays 50-100 while
  // the card lied +0); the FightResult object read below is the fallback when a receipt carried no event.
  let xp = Number(xp_share ?? 0)
  let character = character_id

  // VICTORY-CARD XP (07-11/07-12 "+0 XP"/"appearing slow"): resolve off the ALREADY-HELD ResultOpened
  // event data THE INSTANT we hold it — this used to sit AFTER the chain re-read + mint/burn below, a whole
  // on-chain tx gating a number the client already knew. The mint/burn owes the card nothing (loot rides the
  // FightResult dispatch below). Only a real WIN carries xp_share > 0 (a defeat is 0 → skipped).
  const resolve_reward = (xp_value, rolled_value, character_value) => {
    if (!(xp_value > 0 && character_value)) return
    const char = context.get_state().sui?.characters?.find((/** @type {any} */ c) => c.id === character_value)
    const before = Number(char?.experience ?? 0)
    const levels_gained = Math.max(0, experience_to_level(before + xp_value) - experience_to_level(before))
    // ResultOpened's xp_share is the chain-paid DELTA — patch the roster immediately, not just the modal.
    apply_fight_receipt(character_value, { xp_share: xp_value })
    context.dispatch('action/fight_result/resolve', {
      xp: xp_value,
      level: experience_to_level(before + xp_value),
      levels_gained,
      points_gained: levels_gained * 5, // reference-corpus grant: 5 characteristic points per level crossed
      loot_units: rolled_value, // the card renders this many loot skeletons until the items delta lands — 0 stays 0
      // engine-bus reconcile metadata: the Character read waits until /v1 reaches this receipt-derived total.
      character_id: character_value,
      expected_experience: before + xp_value,
      result_id,
    })
  }
  resolve_reward(xp, rolled_units, character)

  // Render loot IMMEDIATELY off loot_units (leg②); resolved:false so the reducer never lets this regress an
  // already-landed richer dispatch (the object read below reconciles BEHIND it, unwiped on a read failure).
  if (rolled_units > 0)
    context.dispatch('action/fight_result/loot', {
      result_id,
      loot: floor_loot(rolled_units),
      resolved: false,
    })

  // FIX 3 (07-13 — NO refetch): the correlated ResultMinted event carries `final_hp` — apply it straight
  // into the roster's HP block, zero extra RPC. Event-sourced fast path; the object-read below is the fallback
  // when the receipt lacks that event (same on-chain HP scale as character_max_hp — projected_hp reads it honestly).
  if (final_hp != null && character) apply_fight_receipt(character, { final_hp })

  if (result_id) {
    // MINT DECOUPLED (stranded-loot fix, pending_mints.js): the mint rides the receipt-driven queue now, NOT the
    // bounded display read — the old `if (result)` gate SKIPPED mint_all_and_burn on a null ~5s read, stranding the
    // opened FightResult soulbound (a 41-deep stranded backlog observed live). Null result_id: the queue is the SINGLE owner (no double-fire).
    const mint_outcome = enqueue_mint(result_id)
    if (mint_outcome)
      void mint_outcome
        .then(async (outcome) => {
          if (outcome.verdict !== 'minted') return
          const minted_rows = settled_loot_rows(outcome.settlement, await get_template_map())
          if (!minted_rows.length) return
          context.dispatch('action/fight_result/loot', {
            result_id,
            loot: loot_from_minted_rows(minted_rows),
            resolved: true,
            instances: true,
          })
        })
        .catch(() => {})
    void drain_pending_mints(mint_deps()).catch(() => {})
    setState({ result_id: null })
    // DISPLAY tail (best-effort, off the mint path now): rich loot lines + XP/HP/character read-fallbacks.
    const sdk = await get_sdk()
    const result = await read_result_with_retry(() => get_fight_result({ grpc_client: sdk.grpc_client })(result_id))
    character ??= result?.character ?? null
    if (final_hp == null && result && character)
      apply_fight_receipt(character, { final_hp: Number(result.final_hp ?? 0) }) // fallback
    const rolled = result?.rolled ?? []
    if (loot_units == null)
      rolled_units = rolled.reduce((/** @type {number} */ s, /** @type {any} */ e) => s + Number(e.qty ?? 0), 0)
    // SPOILS RECEIPT LAW (v30, D771): loot lines derive from the FightResult's OWN `rolled` declaration —
    // never an inventory diff. Resolved against the template map; a miss degrades to the D53 letter tile.
    // Fires on the OBJECT READ; a degraded read dispatches nothing — the FLOOR above stands unwiped (leg②).
    if (result)
      context.dispatch('action/fight_result/loot', {
        result_id,
        loot: loot_from_rolled(rolled, await get_template_map()),
        resolved: true,
      })
    // fallback ONLY: a receipt-parse miss (no ResultOpened event) means the fast dispatch above had nothing to
    // show yet — resolve now off the object read.
    if (xp_share == null) {
      xp = Number(result?.xp_share ?? 0)
      resolve_reward(xp, rolled_units, character)
    }
    if (result) item_qty = rolled.reduce((/** @type {number} */ s, /** @type {any} */ e) => s + Number(e.qty ?? 0), 0)
  }
  if (!terminal) setState({ room_recap: { room, xp, item_qty } })
  if (summary_toast)
    // the auto-open success beat (07-10): one honest XP/loot summary — the numbers are what LANDED.
    push_event_toast({ state: 'success', title: i18n.t('dungeons.results_opened', { xp, items: item_qty }) })
  invalidate_pending_outcomes() // this outcome is consumed — the pill's next mount re-fetches what remains
  void load_roster().catch(() => {}) // xp/hp write-backs landed — repaint the roster (the card resolves off it)
  await getState()
    .refresh()
    .catch(() => {})
}

/**
 * The wallet's UNOPENED result row for `character_id`, if any — the PERMANENT post-settle surface (
 * `settle_and_destroy` mints one soulbound FightOutcome to EVERY seat owner silently; every
 * non-janitor participant lands here). Read from `GET /v1/pending-outcomes` (chain-direct reads abolished),
 * ONE memoized fetch per wallet shared by every roster-row pill (pending_outcomes.js) — mount/signal, never polled.
 * @param {string} address @param {string} character_id
 * @returns {Promise<{ outcome_id: string, character_id: string, fight_id: string|null, world_id: string|null } | null>}
 */
export async function find_pending_outcome(address, character_id) {
  if (!address || !character_id) return null
  const map = await pending_outcomes_for(address, get_pending_outcomes)
  return map.get(character_id) ?? null
}

/**
 * The awaited fight-entry correction for a PRE-FLIGHT `fight::ECharacterMarked` refusal. A fresh projection read
 * resolves this character's exact outcome id, then the SAME single-flight/manual action above opens it. Only the
 * open receipt returns to the entry reducer; an executed entry/open failure is never retried and its original
 * error surfaces untouched. This replaces the old abort-hook callback, which could open after entry had died.
 * @param {any} store @param {string} character_id @param {unknown} refusal
 * @param {{live_world_fight_id?:string|null,live_run_pass_id?:string|null,
 *   force_start_door?:(fight_id:string,silent:boolean)=>Promise<any>}} [opts]
 * @returns {Promise<any>} the shared open receipt (null only for an already-opened stale projection row)
 */
export async function recover_fight_entry_refusal(
  store,
  character_id,
  refusal,
  { live_world_fight_id = null, live_run_pass_id = null, force_start_door } = {}
) {
  await surface_expired_placement_entry_refusal(character_id, refusal, { force_start_door })
  return recover_marked_fight_entry(refusal, {
    find_result: async () => {
      const { address } = use_auth.getState()
      if (!address || !character_id) return null
      // The boot memo may predate a result minted by another seat's settlement. The refusal is a new detection
      // signal, so force one fresh /v1 read; the result-id registry still coalesces an open already in flight.
      invalidate_pending_outcomes()
      return find_pending_outcome(address, character_id)
    },
    open_result: (row) => {
      const { address } = use_auth.getState()
      if (!address) return Promise.resolve({ status: 'blocked', error: refusal })
      announce_auto_claim() // #684: entry-refusal recovery auto-opens with zero other UI surface in view
      return open_pending_row(store, address, character_id, row, {
        allow_run_bound: true,
        live_world_fight_id,
        live_run_pass_id,
        surface_failure: false,
      })
    },
  })
}

/**
 * Open ONE unopened result row (`results::open` — XP/HP write-backs + fight_marker::clear + loot mint/burn).
 * AUTO mode (07-10: "unopened stuff should always auto open whenever detected") fires from the pill's
 * detection with the burn-law rails: one synchronous single-flight claim per outcome_id and ONE attempted auto
 * open per session (executed OR refused failures latch with their honest error; a local deferral attempts no tx
 * and re-arms). Boot leaves a run-bound row on the manual press; entry recovery explicitly runs that same
 * composed `settle_run + open` action. MANUAL may retry a latch, one attempt per press.
 * @param {any} store the use_dungeon zustand store
 * @param {string} address @param {string} character_id
 * @param {{ outcome_id: string, fight_id?: string|null, world_id?: string|null }} row
 * @param {{ manual?: boolean, allow_run_bound?: boolean, live_world_fight_id?: string|null,
 *           live_run_pass_id?: string|null, surface_failure?: boolean }} [opts]
 * @returns {Promise<{status:'opened',receipt:any}|{status:'blocked'|'failed',error:unknown|null}>} `opened`
 *   carries the receipt that re-enters the fight-entry reducer; blocked/failed retain the honest cause.
 */
export function open_pending_row(
  store,
  address,
  character_id,
  row,
  {
    manual = false,
    allow_run_bound = false,
    live_world_fight_id = null,
    live_run_pass_id = null,
    surface_failure = true,
  } = {}
) {
  const { getState, setState } = store
  if (!row?.outcome_id) return Promise.resolve({ status: 'blocked', error: null })
  return run_result_auto_open(
    row.outcome_id,
    async () => {
      // The registry slot above is already bound: any boot/engage detector arriving during this awaited lookup
      // receives this exact Promise instead of racing into the store's busy guard.
      let run_pass_id = null
      try {
        const runs = await get_dungeon_runs({ owner: address })
        run_pass_id = character_run_pass_id(runs, row.fight_id ?? null, character_id)
      } catch (error) {
        game_log('dungeon', 'pending-open: run read failed', error)
        if (manual && surface_failure) push_event_toast({ state: 'error', title: humanize_abort(error) })
        return { status: 'deferred', error }
      }
      if (!manual && !allow_run_bound && run_pass_id) {
        // Boot detection leaves a run-bound row to the panel. Entry recovery opts in to this SAME composed
        // settle_run+open action, without bypassing the automatic result-id latch.
        game_log('dungeon', 'pending-open: run-bound row — left to the manual press (stop-rule)', {
          outcome: row.outcome_id,
          run_pass_id,
        })
        return { status: 'deferred', error: new Error(i18n.t('errors.fight_result_latched')) }
      }
      // A live fight/run owns the shared store. This is a local deferral, not a refused open transaction, so the
      // untouched result re-arms instead of being falsely latched for the rest of the session. The dungeon engage
      // reducer may authorize its exact run/character while it is busy: that busy flag belongs to this awaited
      // repair itself, and every different session remains blocked.
      const session_is_live = () => {
        const live = getState()
        const owns_dungeon_entry =
          live_run_pass_id &&
          live.run_pass_id === live_run_pass_id &&
          live.character_id === character_id &&
          !live.fight_id
        return (
          (live.busy && !owns_dungeon_entry) ||
          (live.run_pass_id && !owns_dungeon_entry) ||
          (live.fight_id && live.fight_id !== live_world_fight_id)
        )
      }
      if (session_is_live()) {
        const error = new Error(i18n.t('errors.fight_result_latched'))
        if (manual && surface_failure) push_event_toast({ state: 'error', title: humanize_abort(error) })
        return { status: 'deferred', error }
      }
      await acquire_settlement_flight(store)
      try {
        // State may have changed while queued behind a different result's transaction.
        if (session_is_live()) {
          const error = new Error(i18n.t('errors.fight_result_latched'))
          if (manual && surface_failure) push_event_toast({ state: 'error', title: humanize_abort(error) })
          return { status: 'deferred', error }
        }
        const { landed, receipt, error } = await land_outcome(store, {
          outcome_id: row.outcome_id,
          run_pass_id: manual || allow_run_bound ? run_pass_id : null,
          world_id: row.world_id ?? null,
          character_id,
          terminal: true,
          summary_toast: true,
          surface_failure,
          automated: !manual, // a press is the player spending their own gas on purpose; a wire is not
        })
        return landed ? { status: 'opened', receipt } : { status: 'failed', error: error ?? null }
      } finally {
        setState({ _settling: false })
      }
    },
    { manual }
  )
}

/**
 * THE SHARED DETECT+AUTO-OPEN ENTRY (live-gap 07-10: "unopened stuff should always auto open whenever
 * DETECTED" — detection must NOT depend on a UI surface; a session once restored straight into the world,
 * the badge never mounted, and the next mob engage hit abort 111). The post-auth BOOT wire calls this once per
 * wallet; the awaited engage/join reducer door owns refusal-time detection separately. One wallet-level pass:
 * the memoized /v1 fetch, then every row
 * through open_pending_row's unchanged rails (single-flight, auto-latch, dungeon-bound = manual only).
 * `announce` copy per row: latched → the manual-badge pointer; fresh/inflight → "opening it now…", and a row
 * that then turns out non-auto-openable (dungeon-bound / session-live) corrects to the manual pointer. The
 * success beat is land_outcome's own XP/loot toast. Never throws (a route hiccup = no detection this signal).
 * @param {any} store the use_dungeon zustand store @param {string} address
 * @param {{ announce?: boolean }} [opts]
 */
export async function auto_open_pending_outcomes(store, address, { announce = false } = {}) {
  if (!address) return
  let map
  try {
    map = await pending_outcomes_for(address, get_pending_outcomes)
  } catch (error) {
    game_log('dungeon', 'pending-open: /v1 detection failed (next signal re-checks)', error)
    return
  }
  for (const [character_id, row] of map) {
    const state = attempt_state(row.outcome_id)
    if (state === 'opened') continue // receipt tombstone outranks a lagging projection row
    if (announce)
      push_event_toast(
        state === 'latched'
          ? { state: 'error', title: i18n.t('errors.fight_result_latched') }
          : { state: 'info', title: i18n.t('errors.fight_result_opening') }
      )
    if (state) continue // inflight (already opening) or latched (manual-only) — never double-fire
    announce_auto_claim() // #684: name the claim BEFORE its tx builds — the boot sweep has no other UI surface
    const res = await open_pending_row(store, address, character_id, row)
    // honest correction: we announced an auto-open but the row is NOT auto-openable (dungeon-bound/session-live)
    if (announce && res.status === 'blocked')
      push_event_toast({ state: 'error', title: i18n.t('errors.fight_result_latched') })
  }
  // LEAF-2 — the terminal-but-UNSETTLED fight the pending-outcomes read above CANNOT see: the settle never ran,
  // so no FightOutcome exists yet (the /v1 pending-outcomes projection is empty). This is EXACTLY that
  // 07-12 abort-111 lockout — a defeated WORLD fight left unsettled marks the character until `results::open`,
  // but there was no outcome ROW for the leaf-3 loop above to find, so this wire did nothing. The badge's roster
  // pill already covers it (recover_character reads /v1/fights); this closes the AUTO wire's blind spot so
  // "unopened stuff should always auto-open whenever DETECTED" (07-10) finally holds for a terminal fight.
  await auto_settle_terminal_fights(store, address, announce)
  // MINT SWEEP (stranded-loot recovery, pending_mints.js): a 41-deep backlog of opened-but-un-burned FightResults recover
  // here — boot/sign-in ONLY (`!announce`), once-per-wallet; /v1 enumerates, every mint is chain-gated. ONE toast.
  if (!announce)
    await sweep_stranded_results(address, {
      ...mint_deps(),
      // The catalog NAMES what the sweep recovered — the toast is a game message, never a chain dump (#1223).
      // A catalog read failure degrades to item_type slugs; it never blocks or fails the recovery itself.
      template_by_id: await get_template_map().catch(() => new Map()),
      fetch_results: get_fight_results,
      notify: (/** @type {number} */ count, details) =>
        push_event_toast({
          state: 'success',
          title: i18n.t('dungeons.results_recovered', { count }),
          // An all-husk sweep collected nothing nameable — the localized title alone is the honest message.
          ...(details ? { message: details } : {}),
        }),
    }).catch((error) => game_log('dungeon', 'mint-sweep failed (next boot re-checks)', error))
}

/**
 * LEAF-2 auto-recovery: settle+open a WALLET character's terminal-but-unsettled WORLD fight under the SAME
 * burn-law rails as the leaf-3 pill — a per-FIGHT attempt latch (an executed settle failure LATCHES to the
 * manual pill, NEVER auto-refired) and the no-live-session guard. A DUNGEON-bound terminal fight (a RunPass still
 * binds it) is left to the MANUAL press (stop-rule 07-10 — auto never improvises the settle_run leg; an
 * unprovable run read is conservatively treated as dungeon-bound). Reads the roster from the shared game store,
 * loading it once if a boot-restore beat the roster fetch.
 * @param {any} store @param {string} address @param {boolean} announce
 */
async function auto_settle_terminal_fights(store, address, announce) {
  const { getState } = store
  let characters = context.get_state().sui?.characters ?? []
  if (!characters.length) {
    await load_roster().catch(() => {}) // a boot-restore can beat the roster fetch — the refusal path already has it
    characters = context.get_state().sui?.characters ?? []
  }
  if (!characters.length) return
  // Wallet-level run read ONCE: a terminal fight bound to a live RunPass stays MANUAL (stop-rule); an
  // unprovable read is conservatively treated as dungeon-bound (auto never improvises the settle_run leg).
  let runs = []
  let runs_ok = true
  try {
    runs = (await get_dungeon_runs({ owner: address })) ?? []
  } catch (error) {
    runs_ok = false
    game_log('dungeon', 'auto-settle: run read failed — terminal fights left to the manual pill', error)
  }
  for (const character of characters) {
    const character_id = character?.id
    if (!character_id) continue
    let fights = []
    try {
      fights = (await get_fights({ character: character_id })) ?? []
    } catch {
      continue // read hiccup → skip; the next signal re-checks
    }
    // A still-indexed victory/defeat doc = settle_and_destroy never ran (the doc dies with the settle).
    const terminal = fights.find((f) => f && (f.status === 'victory' || f.status === 'defeat'))
    const fight_id = terminal && (terminal.fight_id ?? terminal.fight)
    if (!fight_id || attempt_state(fight_id)) continue // none, or inflight/latched — never double-fire
    if (!runs_ok || runs.some((r) => r && (r.fight_id ?? r.fight) === fight_id)) {
      if (announce) push_event_toast({ state: 'error', title: i18n.t('errors.fight_result_latched') })
      continue // dungeon-bound / unprovable → the manual pill owns the settle_run leg
    }
    if (getState()._settling || getState().busy || getState().fight_id || getState().run_pass_id) {
      continue
    }
    if (announce) push_event_toast({ state: 'info', title: i18n.t('errors.fight_result_opening') })
    announce_auto_claim() // #684: this leaf settles+opens a stranded terminal fight — same silent-tx exposure
    await settle_chain_latched(store, {
      terminal: true,
      fight_id,
      world_id: terminal.world ?? null,
      character_id,
    })
  }
}

/**
 * RECOVERY (P0 anti-brick, leaf 2): finish the settlement of a character stranded with an unopened terminal
 * fight — the FORFEIT/partial-settle brick, where the fight_marker never cleared (it clears ONLY through
 * `results::open`). Reads the character's still-indexed TERMINAL fight from the keyless read-API (the doc is
 * deleted on Settled/Swept, so a present victory/defeat doc = genuinely unsettled), resolves its RunPass
 * (dungeon → settle_run advances/consumes the pass) or none (world), then drives the SAME settle_chain. A live
 * session must NOT be running (the caller guards) — settle_chain nulls the store's fight_id as it works.
 * @param {any} store the use_dungeon zustand store @param {string} character_id
 * @returns {Promise<'clean' | 'recovered' | 'failed'>} clean = nothing pending; recovered = marker cleared.
 */
export async function recover_character(store, character_id) {
  const { address } = use_auth.getState()
  if (!address || !character_id) return 'clean'
  let fights = []
  try {
    fights = await get_fights({ character: character_id })
  } catch (error) {
    game_log('dungeon', 'recover: fight read failed', error)
    push_event_toast({ state: 'error', title: i18n.t('errors.tx_failed') })
    return 'failed'
  }
  // TERMINAL (victory/defeat) + still indexed = settle_and_destroy never ran. placement/active = still live.
  // No fight doc ≠ clean: a settled-elsewhere fight leaves an UNOPENED FightOutcome the doc-based read cannot
  // see (the doc dies with the settle) — the /v1 pending-outcomes leg opens it (MANUAL here: the press may
  // retry a latched outcome and takes the settle_run leg when a RunPass matches).
  const pending = (fights ?? []).find((f) => f && (f.status === 'victory' || f.status === 'defeat'))
  if (!pending) {
    let row = null
    try {
      row = await find_pending_outcome(address, character_id)
    } catch (error) {
      game_log('dungeon', 'recover: pending-outcomes read failed', error)
      push_event_toast({ state: 'error', title: i18n.t('errors.tx_failed') })
      return 'failed'
    }
    if (!row) return 'clean'
    const res = await open_pending_row(store, address, character_id, row, { manual: true })
    return res.status === 'opened' ? 'recovered' : 'failed'
  }
  const fight_id = pending.fight_id ?? pending.fight
  // A row that came back WITHOUT a world still settles (#1396): the settle carries the character's latch and
  // derives nothing, so a null here costs only the settle_run leg's world — never the un-brick itself.
  const world_id = pending.world ?? null
  // Resolve the RunPass if this was a dungeon room fight (so settle_run consumes the defeated pass too); a world
  // fight has none → settle_chain takes the open_outcome branch. A missing run still un-bricks (open clears the
  // marker) — the pass is then just an orphan the player leaves from the dungeons gate. Field names read both
  // shapes (the shaped view returns pass_id/fight_id; the stale RpcDungeonRun type says pass/fight).
  let run_pass_id = null
  try {
    const runs = await get_dungeon_runs({ owner: address })
    run_pass_id = character_run_pass_id(runs, fight_id, character_id)
  } catch (error) {
    game_log('dungeon', 'recover: run read failed — settling as a world fight (pass left for manual leave)', error)
  }
  // character_id is EXPLICIT here — recovery runs with no live session, so state.character_id is null; the open
  // leg's kiosk-derive would otherwise resolve nothing and the badge could never un-brick a multi-kiosk wallet.
  const ok = await settle_chain(store, {
    terminal: true,
    fight_id,
    run_pass_id,
    world_id,
    character_id,
  })
  return ok ? 'recovered' : 'failed'
}

/**
 * Mint whatever an OPENED FightResult still owes AND burn it for the rebate — the manual loot-retry surface,
 * driven by the SAME atomic mint+burn PTB as finish_result (mint_all_and_burn): the burn's on-chain
 * `rolled.is_empty()` assert gates it (results.move:170), so CHAIN truth — never a client read — decides. If any
 * mint aborts, the whole PTB reverts (loot stays, retriable). `result_id` clears ONLY on a landed atomic PTB; on
 * a failed/degraded read (null) or an on-chain revert it stays, so a later press picks the remainder back up.
 */
export async function mint_owed(store) {
  const { getState, setState } = store
  const { result_id } = getState()
  if (!result_id) return
  const sdk = await get_sdk()
  const result = await get_fight_result({ grpc_client: sdk.grpc_client })(result_id).catch(() => null)
  if (!result) return // read failed — leave result_id for the next press (never burn on a blind read)
  try {
    await mint_and_reduce_inventory(
      result_id,
      (result.rolled ?? []).map((/** @type {any} */ e) => e.item_template)
    )
    setState({ result_id: null })
  } catch (error) {
    game_log('dungeon', 'atomic mint+burn reverted (loot remains on the result — retry the surface):', error?.message)
  }
}
