// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-57 — the S-46 FIGHT + DUNGEON lifecycle tx seam (replaces the dead board-13 driver wholesale; every old
// `dungeon::*_registered` / `dungeon_turn::*` / `dungeon_claim::*` Move target died in the S-46 engine split).
// One fn per DEPLOYED door, built by the `@aresrpg/sdk` per-domain builders (ids resolve through the SDK's ONE
// stamp-or-throw deployment home — zero hardcoded 0x here) and signed through the same instrumented
// sign→execute→wait choke every gameplay tx uses. The lifecycle:
//
//   world fight: zones::claim_mob_group + fight::create (ONE PTB) → place → commit_turn (the WHOLE turn as
//                ONE PTB: deterministic act_* + terminal act_pass, the tx's single &Random — design ruling 2026-07-11) →
//                settlement::settle_and_destroy → results::open (terminal &Random) → mint_rolled → burn_result
//   dungeon run: dungeon::activate (burns the key → RunPass) → dungeon::next_fight (room Fight, pass latched) →
//                same engine turns → settle_and_destroy → [dungeon::settle_run + results::open in ONE PTB —
//                settle_run BORROWS the FightOutcome, open then CONSUMES it; Random stays terminal] →
//                mint_rolled per rolled template → burn_result. dungeon::abandon exits a run anytime.
//
// CLIENT-LOOP LAWS: a `&Random` call is TERMINAL in its PTB (Sui Random-PTB rule — the turn batch ends
// in act_pass; every OTHER &Random door is its own tx); crank/force_start are SILENT permissionless janitors
// fired only past an on-chain deadline (fight-liquidation.js owns the latch; the commit flow also auto-cranks
// ONCE on the distinct turns::ESomeoneOverdue simulation refusal — pre-execution, zero gas, never blind);
// an EXECUTED failure (digest exists = gas burned) is NEVER auto-retried — callers latch and stop.
//
// SIZE-LAW SPLIT (2026-07-20, 785 LoC over the ≤600 cap): create_world_fight (+ its claim/proof helpers) and
// the standalone mint_rolled/burn_result doors moved to `dungeon_engage_actions.js` — the only slice with ZERO
// cycle-embedded consumer (owned_team_actions.js/dungeon_settlement.js/fight-liquidation.js/dungeon_run_store.js
// already sit inside the baselined `auth`-rooted import cycle and need the rest from this exact path; moving
// those would close a NEW unbaselined cycle — verified with depcruise-gate.sh). `sign`/`ctx_of`/
// `remember_created_fight` exported below for the sibling to import back, one-directionally.

import {
  place_ptb,
  force_start_ptb,
  crank_ptb,
  commit_turn_ptb,
  abandon_fight_ptb,
  open_result_ptb,
  settle_and_take_ptb,
  open_taken_ptb,
  settle_run_taken_ptb,
  settle_open_world_ptb,
  mint_rolled_ptb,
  burn_result_ptb,
  join_fight_ptb,
  decode_fight_event,
  turn_gas_budget_mist,
  MEASURED_TURN_GAS_MIST,
} from '@aresrpg/sdk/fight'
import {
  activate_ptb,
  next_fight_ptb,
  join_fight_ptb as join_dungeon_fight_ptb,
  settle_run_ptb,
  abandon_ptb,
} from '@aresrpg/sdk/dungeon'

import { use_auth, sign_and_execute_transaction } from '../auth'
import { get_sdk } from '../chain/sdk'
import { normalize_receipt } from '../chain/receipt'
import { DEMO_NETWORK } from '../chain/deployment'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { tx_error } from '../game/core/abort_copy.js'
// LATENCY LEVERS: the per-fight dry-run budget cache (skip repeat dry-runs) + the finality poll diet + the
// ?txtiming=1 per-leg instrumentation. The cache is cleared at every fight boundary below.
import { clear_budget_cache } from '../tx/budget_cache.js'
// GAS-COIN PIN (<1s lane): chain the fight's gas coin across commits so each commit's build resolves
// ZERO gas round-trip. chain_gas_from_receipt stamps the fresh coin + epoch price after a commit lands; a fight
// boundary / commit failure drops it (see gas_coin_cache.js for the full money-safety invalidation matrix).
import { chain_gas_from_receipt, invalidate_gas_coin, clear_gas_coin_cache } from '../tx/gas_coin_cache.js'
// FIGHT SHARED-REF CACHE: pin the runtime Fight object (its immutable initial_shared_version) so each act PTB
// builds WITHOUT the tx-build resolve round-trip — the singletons/Clock/Random are already pinned, so a
// pinned-fight act PTB resolves nothing (build-offline). One owner-read per fight; cleared at each boundary.
import { ensure_fight_shared_ref, remember_fight_shared_version, clear_fight_ref_cache } from '../tx/fight_ref_cache.js'
import { FINALITY_POLL_SCHEDULE, flush_leg, now } from '../tx/latency.js'
import { mark_engage_ptb_built, mark_engage_receipt_ready, note_engage_fight_id } from '../core/engage_timing.js'
import { game_log } from '../core/log.js'

// ── SDK per-domain builders (context-bound at call time — the kiosk_client rides the memoized SDK) ──────────

/**
 * The builder context: network + the memoized SDK's kiosk client (activate's borrow-val dance needs it).
 * Exported (+ `sign`, `remember_created_fight` below): dungeon_engage_actions.js rides this SAME tx choke.
 */
export const ctx_of = (/** @type {any} */ sdk) => ({ network: DEMO_NETWORK, kiosk_client: sdk.kiosk_client })

// Kiosk resolution — THE one derive-from-character home (kiosk_resolve.js; traced 2026-07-09: a first-cap
// or scan pick against a multi-kiosk wallet built PTBs on the WRONG kiosk → 0x2::kiosk borrow aborts).
// `any_personal_kiosk` stays legal ONLY as the loot lock-target (mint_rolled/burn — no character binding).
// The character↔world binding — the ONE home for which world a character is in, and therefore the derivation
// scope (registry shard) of any WORLD fight it joins.
import { use_world_binding } from './session_gate.js'
import { kiosk_for_character, any_personal_kiosk, cap_for_kiosk } from './kiosk_resolve.js'
// FIGHT COST LEDGER: the per-fight net-gas accumulator the result card reads.
import { use_fight_cost } from './fight_gas_ledger.js'
// #1206 — the F-07 half the client owes the chain: a fight snapshots ONLY the spell ids its PTB names.
import { raised_spell_ids_for } from './raised_spells.js'
import { offer_travel_resync } from './travel_recovery.js'
import { receipt_final_hp } from './fight_result_receipt.js'
import { result_open_intent } from './pending_outcomes.js'
import { attach_executed_digest } from './tx_digest_error.js'
import { run_character_action } from './tx.js'

// ONE-TOAST SEQUENCES: a fight turn (N act_* txs + act_pass) or a settlement chain (settle →
// open → mint×N → burn) is a SEQUENCE of standalone txs (each &Random door is its own PTB). `batching`
// suppresses every inner sign()'s own toast while a wrapped sequence is in flight (store actions run these
// strictly sequentially under their own flight guards, so this module-level flag never straddles two flows).
let batching = false

/**
 * Run `fn` (a store action sequencing several standalone txs) under ONE aggregate toast instead of one per
 * inner tx. Call from the UI trigger (mob-click / END TURN), never from inside the store itself.
 * @template T @param {string} label @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export async function as_one_toast(/** @type {string} */ label, /** @type {() => Promise<any>} */ fn) {
  batching = true
  try {
    // Pass the task LAZILY: the pending state paints at intent before any preflight/compose work starts.
    // D57a: NO success toast — the visible transition IS the confirmation. Errors still toast.
    return await use_toast.getState().promise(fn, {
      pending: i18n.t('dungeons.tx_pending', { label }),
    })
  } finally {
    batching = false
  }
}

// TOAST COPY LAW: `label` always names the action. SILENT: a background/janitor tx (crank, force_start, the
// settlement chain) signs with NO toast at all — failure still throws identically (the caller discriminates).
// SPEND GUARD (#1262): `intent` (`<kind>:<target object>`) + `automated` ride through to the lane, where the
// circuit / backoff / session breaker decide whether an automated submission may be sent at all. They are
// declared HERE, on the doors, not at each caller — every crank caller gets the same guarantee from one place.
export async function sign(
  /** @type {any} */ tx,
  /** @type {string} */ label,
  /** @type {boolean} */ silent = false,
  /** @type {import('../tx').GasPin | null} */ gas_pin = null,
  /** @type {{ queued?: boolean, intent?: string|null, automated?: boolean }} */ {
    queued = false,
    intent = null,
    automated = false,
  } = {}
) {
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) throw new Error('Not signed in')
  const sdk = await get_sdk()
  const execute = async () => {
    // EXECUTE-CERT (<1s lane, measured 07-12): `want_effects` makes the tx choke return the CERTIFIED effects in
    // the execute round-trip itself (`effects_result`), so the separate waitForTransaction read below — ~570ms of
    // pure fullnode ledger-availability lag on testnet — is skipped whenever the fast path applied. The wait stays
    // as the FALLBACK for the paths that return no effects_result (sponsor-first / gas-station fallback / a wallet
    // without sign-only), so every receipt still resolves to the same RAW shape both uses below consume.
    const { digest, effects_result } = await sign_and_execute_transaction(
      wallet_name,
      address,
      tx,
      gas_pin ?? undefined,
      true
    )
    try {
      const wait_t0 = now()
      // RAW result kept (normalize_receipt strips the gasObject the pin chains from) — one result, both uses.
      const raw =
        effects_result ??
        (await sdk.grpc_client.core.waitForTransaction({
          digest,
          include: { effects: true, objectTypes: true, events: true },
          pollSchedule: FINALITY_POLL_SCHEDULE, // FINALITY DIET: 250ms detection vs the SDK's up-to-2000ms dead zones
        }))
      const res = normalize_receipt(raw)
      flush_leg(tx, label, now() - wait_t0) // ?txtiming=1: submit→effects wait (≈0 on the EXECUTE-CERT path)
      mark_engage_receipt_ready(tx)
      // FIGHT COST LEDGER: a digest here means src/tx's choke already dry-ran + executed
      // on-chain — real gas is spent whether this lands success or an on-chain abort (tx-retry-burn law: a
      // digest = gas burned), so fold it in BEFORE the success-check throw below.
      use_fight_cost.getState().add(res.gasUsed)
      // Aborted tx → throw the humanized error (never a lying success). The structured MoveAbort rides `.cause`.
      if (res?.effects?.status?.status !== 'success') {
        game_log('fight-tx', `failed on-chain (${digest}):`, res?.effects?.status?.error)
        clear_budget_cache() // executed on-chain failure → drop the fight's cached budgets (never reuse a just-failed shape)
        if (gas_pin) invalidate_gas_coin() // + the chained gas coin (an abort still mutates it; re-select fresh next commit)
        throw tx_error(res?.effects?.status?.error)
      }
      // TURN COMMIT landed → chain its fresh gas coin + epoch price for the NEXT commit's zero-round-trip build.
      // NON-BLOCKING (<1s lane): the coin stamp inside is SYNCHRONOUS (runs before the first await); only the
      // epoch-price read floats — it is bookkeeping for the NEXT commit, and its documented failure mode is a pin
      // miss → ordinary gas selection (gas_coin_cache.js). Never worth ~150ms on the hot path.
      if (gas_pin) void chain_gas_from_receipt(sdk, raw).catch(() => {})
      // The DIGEST rides the receipt (#978): a caller that must OBSERVE this tx on the read node before judging
      // it (the boot heal re-reads the fight it just force-started) needs the id of what it sent. Purely additive.
      return { ...res, digest }
    } catch (error) {
      // From this point onward submission returned a digest: even a network-looking finality error is EXECUTED.
      // Preserve that proof so every automatic claim/settlement caller latches instead of spending gas again.
      throw attach_executed_digest(error, digest)
    }
  }
  const submitted = run_character_action(execute, { queued, intent, automated }).catch((error) => {
    // create_world_fight has its own fast receipt choke instead of world-shell/tx.js. Give checkpoint::102
    // the same one-click body resync here; this helper never re-submits an executed transaction.
    offer_travel_resync(error)
    throw error
  })
  if (batching || silent) return submitted
  return use_toast.getState().promise(submitted, {
    pending: i18n.t('dungeons.tx_pending', { label }),
    success: label, // D80: morph-to-checkmark, never "<label> confirmed" dev-speak
  })
}

/** First CREATED object whose type ends with `suffix`, from a receipt's objectChanges. */
function created_id(/** @type {any} */ receipt, /** @type {string} */ suffix) {
  const created = (receipt?.objectChanges ?? []).find(
    (/** @type {any} */ c) => c.type === 'created' && String(c.objectType ?? '').endsWith(suffix)
  )
  return created?.objectId ?? null
}

/**
 * The freshly-created Fight's id, ALSO caching its pinned shared ref for free: a Fight is created AND shared
 * in the same `fight::create` / `dungeon::next_fight` PTB, so its `created` version IS the shared object's
 * IMMUTABLE initial_shared_version (Sui freezes it at share-time). Remembering it here means the creator's
 * first act pins the Fight with ZERO extra read (only join/resume pays the one owner-read via ensure_*).
 * Exported: create_world_fight (dungeon_engage_actions.js) needs this too — one home, imported back.
 * @param {any} receipt @returns {string|null}
 */
export function remember_created_fight(/** @type {any} */ receipt) {
  const c = (receipt?.objectChanges ?? []).find(
    (/** @type {any} */ o) => o.type === 'created' && String(o.objectType ?? '').endsWith('::fight::Fight')
  )
  if (c?.objectId && c?.version) remember_fight_shared_version(c.objectId, c.version)
  return c?.objectId ?? null
}

/**
 * THE one receipt-parse home for an open leg (ground truth 07-11: the chain PAYS — ResultOpened events carry
 * xp_share 50-100 while the card showed +0): read `ResultOpened{result, character, xp_share, loot_units}` and
 * correlate that character with `ResultMinted{character, final_hp}` from the SAME atomic receipt. Both event
 * homes match by suffix and decode through the SDK's tested numeric coercer. `result_id` prefers the opened
 * event and falls back to the created-object scan — a receipt-normalization drift in either lane can no longer
 * blank the settlement tail. Every settle/open door below returns this shape; finish_result renders it.
 * @param {any} receipt a normalized receipt (`{ events: [{ type, parsedJson }] }`)
 * @returns {{ result_id: string|null, xp_share: number|null, loot_units: number|null, final_hp: number|null }}
 */
function opened_result_of(/** @type {any} */ receipt) {
  const raw = (receipt?.events ?? []).find((/** @type {any} */ e) => String(e?.type ?? '').endsWith('::ResultOpened'))
  const ev = raw ? decode_fight_event(raw) : null
  return {
    result_id: ev?.result ?? created_id(receipt, '::results::FightResult'),
    xp_share: ev ? Number(ev.xp_share ?? 0) : null,
    loot_units: ev ? Number(ev.loot_units ?? 0) : null,
    // ResultOpened does NOT carry HP. Settlement's ResultMinted does, once per seat; correlate by character so
    // multiplayer receipts never apply another participant's value. Missing means null, preserving the existing
    // FightResult-read fallback instead of fabricating 0 HP from Number(undefined ?? 0).
    final_hp: receipt_final_hp(receipt?.events, ev?.character, decode_fight_event),
  }
}

// ╔════════════════ [ WORLD FIGHT — join (create_world_fight moved to dungeon_engage_actions.js) ] ═ ]

/** JOIN an existing world fight during placement — `fight::join` (public/party gate is on-chain). */
/**
 * The fight's DERIVATION SCOPE is not optional and has no sane default. The registry is sharded, the chain
 * asserts the door got the shard its scope maps to, and the scope is the Fight's OWN `world` field — which for a
 * dungeon room is the CREATOR's RunPass, not the run's world. Defaulting to `world_id` would address the wrong
 * shard for every party member but the creator, so a missing scope refuses here, by name, before any signing.
 * @param {string|null|undefined} scope @param {string} where
 */
function assert_fight_scope(scope, where) {
  if (!scope)
    throw new Error(
      `[${where}] missing fight_scope_id — the Fight's own world field picks its registry shard; pass it from fight state, never from the run's world_id.`
    )
}

export async function join_world_fight({ fight_id, character_id, party_id = null, queued = false }) {
  // A WORLD fight derives from the World itself, and the engine only seats a character that is IN that world —
  // so the joiner's binding IS the fight's scope, and the shard follows from it. One home (session_gate), no
  // caller plumbing, and no chance of a UI surface passing the run's world for a dungeon by mistake: this door
  // is the world path by definition (a room fight joins through `join_room_fight`).
  const fight_scope_id = use_world_binding.getState().world
  assert_fight_scope(fight_scope_id, 'join_world_fight')
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const [handle, raised_spell_ids] = await Promise.all([
    kiosk_for_character(sdk, address, character_id),
    raised_spell_ids_for(character_id), // #1206 — the seat's LEARNED levels ride the join snapshot
  ])
  if (!handle) throw new Error('That character is not in your kiosk')
  const tx = join_fight_ptb(ctx_of(sdk))({
    fight_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    party_id,
    raised_spell_ids,
  })
  return sign(tx, i18n.t('dungeons.action_join', { dungeon: i18n.t('fights.a_fight') }), false, null, { queued })
}

// ╔════════════════ [ DUNGEON RUN — activate / room fights / abandon ] ══════════ ]

/**
 * ENTER a dungeon (§9 "the key IS the run"): burn ONE locked key unit → mint a bound `RunPass` at room 1
 * (`dungeon::activate`, composite PTB: extract key → borrow character → activate → return character).
 *
 * The key and the character do NOT have to share a kiosk (a multi-kiosk wallet — the "key visible but not
 * usable" bug: a key sitting in a sibling kiosk aborted EItemNotFound because the burn leg used to assume the
 * CHARACTER's kiosk). Pass `key_kiosk_id` (from the item row that holds it — read_staking.js's union bag now
 * threads it) to burn from THAT kiosk instead; `key_kiosk_cap_id` is used if given, else resolved from the
 * kiosk id (cap_for_kiosk, cheap — one wallet-caps read). Both omitted → back-compat: burns from the
 * character's own kiosk exactly as before. The CHARACTER borrow leg always uses the character's kiosk — two
 * different kiosks in one PTB is normal Sui.
 * @param {{ world_id:string, character_id:string, key_item_id:string, key_kiosk_id?:string|null, key_kiosk_cap_id?:string|null }} args
 * @returns {Promise<{ receipt:any, run_pass_id:string|null }>}
 */
export async function activate_run({
  world_id,
  character_id,
  key_item_id,
  key_kiosk_id = null,
  key_kiosk_cap_id = null,
}) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in your kiosk')
  // Resolve the key-burn leg's cap only when the caller knows WHICH kiosk holds the key but not its cap.
  const resolved_key_cap_id =
    key_kiosk_id && !key_kiosk_cap_id ? await cap_for_kiosk(sdk, address, key_kiosk_id) : key_kiosk_cap_id
  const tx = activate_ptb(ctx_of(sdk))({
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    key_item_id,
    key_kiosk_id: key_kiosk_id ?? undefined,
    key_kiosk_cap_id: resolved_key_cap_id ?? undefined,
  })
  const receipt = await sign(tx, i18n.t('dungeons.action_join', { dungeon: i18n.t('fights.a_dungeon') }))
  return { receipt, run_pass_id: created_id(receipt, '::run::RunPass') }
}

/**
 * NEXT FIGHT (§9): mint the pass's CURRENT room Fight from the roster and latch the pass to it
 * (`dungeon::next_fight`, deterministic). Fires from the mob-cluster ENGAGE click only (tx-provenance law).
 * @returns {Promise<{ receipt:any, fight_id:string|null }>}
 */
export async function next_room_fight({ world_id, run_pass_id, mob_template_id, character_id }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const [handle, raised_spell_ids] = await Promise.all([
    kiosk_for_character(sdk, address, character_id),
    raised_spell_ids_for(character_id), // #1206
  ])
  if (!handle) throw new Error('That character is not in your kiosk')
  const tx = next_fight_ptb(ctx_of(sdk))({
    world_id,
    run_pass_id,
    mob_template_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    raised_spell_ids,
  })
  mark_engage_ptb_built(tx)
  use_fight_cost.getState().reset() // FRESH fight entry — its own gas is the first line of the new total
  clear_budget_cache() // and drop any prior fight's cached act budgets (a new fight = new shapes)
  clear_fight_ref_cache() // + the prior fight's pinned shared-ref (a new fight = a new object)
  clear_gas_coin_cache() // + the prior fight's chained gas-coin pin (a new fight re-selects + re-chains)
  const receipt = await sign(tx, i18n.t('dungeons.action_start_room_all'))
  const fight_id = remember_created_fight(receipt) // + cache its pinned shared ref (zero-read)
  note_engage_fight_id(tx, fight_id)
  return { receipt, fight_id }
}

/**
 * JOIN a party member's room fight (`dungeon::join_fight`): same-room proven on-chain by re-deriving the fight
 * from `creator_pass_id` + MY OWN pass's room. Latches my pass.
 */
export async function join_room_fight({ fight_id, run_pass_id, creator_pass_id, character_id }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const [handle, raised_spell_ids] = await Promise.all([
    kiosk_for_character(sdk, address, character_id),
    raised_spell_ids_for(character_id), // #1206
  ])
  if (!handle) throw new Error('That character is not in your kiosk')
  const tx = join_dungeon_fight_ptb(ctx_of(sdk))({
    fight_id,
    run_pass_id,
    creator_pass_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    raised_spell_ids,
  })
  use_fight_cost.getState().reset() // FRESH fight entry (my own join) — its own gas is the first line of the new total
  clear_budget_cache() // and drop any prior fight's cached act budgets (a new fight = new shapes)
  clear_fight_ref_cache() // + the prior fight's pinned shared-ref (a new fight = a new object)
  clear_gas_coin_cache() // + the prior fight's chained gas-coin pin (a new fight re-selects + re-chains)
  return sign(tx, i18n.t('dungeons.action_join', { dungeon: i18n.t('fights.a_fight') }))
}

/** ABANDON a run after proving custody of its bound character; exit-safe even during a freeze. */
export async function abandon_run(/** @type {string} */ run_pass_id, /** @type {string|null} */ character_id = null) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const bound_character = character_id ?? (await sdk.get_run_pass(run_pass_id))?.character
  if (!bound_character) throw new Error('That run has no bound character')
  const handle = await kiosk_for_character(sdk, address, bound_character)
  if (!handle) throw new Error('That character is not in your kiosk')
  const tx = abandon_ptb(ctx_of(sdk))({
    run_pass_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
  })
  return sign(tx, i18n.t('dungeons.action_abandon'))
}

// ╔════════════════ [ ENGINE turns — place / force_start / crank / commit_turn ] ═══ ]
// place/force_start/crank are TERMINAL-&Random ENGINE doors (each its own standalone tx); commit_turn_batch is
// THE turn tx — deterministic act_* MoveCalls + act_pass as its one terminal &Random (ENGINE_VERSION — SDK truth).

/** PLACE: pick a near-side start cell + READY (`turns::place`; the LAST ready auto-starts the fight). */
export async function place(
  /** @type {string} */ fight_id,
  /** @type {string} */ character_id,
  /** @type {number} */ cell
) {
  const sdk = await get_sdk()
  const fight_arg = (await ensure_fight_shared_ref(sdk, fight_id)) ?? fight_id // pinned ref (build-offline) or id
  const tx = place_ptb(ctx_of(sdk))({ fight_id: fight_arg, character_id, cell })
  return sign(tx, i18n.t('dungeons.action_place'))
}

/** FORCE-START a fight whose placement window expired (`turns::force_start`, permissionless janitor). No human
 *  ever presses this — it is machinery, so it is `automated` for the spend guard by definition (#1262). */
export async function force_start(/** @type {string} */ fight_id, /** @type {boolean} */ silent = false) {
  const sdk = await get_sdk()
  const fight_arg = (await ensure_fight_shared_ref(sdk, fight_id)) ?? fight_id
  const tx = force_start_ptb(ctx_of(sdk))({ fight_id: fight_arg })
  return sign(tx, i18n.t('dungeons.action_start_room_all'), silent, null, {
    intent: `force_start:${fight_id}`,
    automated: true,
  })
}

/** CRANK a stalled ACTIVE fight past its turn deadline (`turns::crank`, permissionless janitor) — #1262's
 *  transaction. Every caller (the liquidation poll, the boot-resume heal, the commit path's inner crank) reaches
 *  the chain through here, so ONE intent key covers them all: an executed failure retires the door for this
 *  fight, for this session, no matter which of them observes the next expiry. */
export async function crank(/** @type {string} */ fight_id, /** @type {boolean} */ silent = false) {
  const sdk = await get_sdk()
  const fight_arg = (await ensure_fight_shared_ref(sdk, fight_id)) ?? fight_id
  const tx = crank_ptb(ctx_of(sdk))({ fight_id: fight_arg })
  return sign(tx, i18n.t('dungeons.action_pass_turn'), silent, null, {
    intent: `advance_turn:${fight_id}`,
    automated: true,
  })
}

/**
 * COMMIT the WHOLE TURN as ONE PTB ("a turn should be a single PTB"): the staged
 * deterministic actions — `{kind:'move',cell}` / `{kind:'weapon',target_cell}` / `{kind:'cast',
 * spell_template_id,target_cell}` — compose sequentially, then `act_pass` lands LAST as the tx's single
 * terminal `&Random` (the mob wave). ATOMIC: one illegal action reverts the whole turn, nothing partially
 * applies. An empty `actions` array is the skip (one bare act_pass). `silent` for the deadline auto-commit.
 *
 * GAS (<1s lane): the gas COIN is pinned on every commit (chained from the last commit's receipt →
 * zero gas round-trip on build). `solo` additionally SKIPS the per-commit dry-run and pins the MEASURED budget
 * (turn_gas_budget_mist × 1.5): a solo fight can never abort turns::ESomeoneOverdue (that needs a second player
 * seat), so its shape needs no simulate. MULTIPLAYER (`solo=false`) KEEPS the dry-run — the sim both budgets it
 * (sim ×1.5) AND catches ESomeoneOverdue at ZERO gas so the store's overdue auto-crank stays a pre-execution
 * refusal (never an executed-failure retry). The caller passes solo = (one player participant in the fight).
 * @param {string} fight_id @param {string} character_id
 * @param {Array<{ kind: 'move', cell: number } | { kind: 'weapon', target_cell: number } |
 *   { kind: 'cast', spell_template_id: string, target_cell: number }>} actions
 * @param {boolean} silent @param {boolean} solo one player seat ⇒ skip the dry-run + pin the measured budget
 */
export async function commit_turn_batch(fight_id, character_id, actions, silent = false, solo = false) {
  // DEV failure fixture: model a wallet submission that returned a digest and then failed. The Lane-68 proof
  // drive turns this on only in a dev page; no transaction is built or sent, and production strips the branch.
  if (import.meta.env.DEV && typeof window !== 'undefined' && /** @type {any} */ (window).__ARES_DEV_FAIL_TURN_COMMIT) {
    const target = /** @type {any} */ (window)
    target.__ARES_DEV_FAIL_TURN_COMMIT_COUNT = (target.__ARES_DEV_FAIL_TURN_COMMIT_COUNT ?? 0) + 1
    throw attach_executed_digest(
      new Error('lane68 injected executed commit failure'),
      `lane68-executed-${target.__ARES_DEV_FAIL_TURN_COMMIT_COUNT}`
    )
  }
  const sdk = await get_sdk()
  const fight_arg = (await ensure_fight_shared_ref(sdk, fight_id)) ?? fight_id // pinned Fight ref → build-offline
  const tx = commit_turn_ptb(ctx_of(sdk))({ fight_id: fight_arg, character_id, actions })
  // SKIP the dry-run ONLY for a solo fight WITH a stamped budget: pin the MEASURED budget the skip path keeps.
  // GRACEFUL DEGRADATION (money-safe): until the constant is measured the solo commit FALLS BACK to the sim path
  // (skip_sim=false) — the shape IS simulatable, so this is the proven behavior, never a guessed budget; it just
  // forgoes the latency win until stamped. Multiplayer always keeps the sim. The gas COIN is pinned EITHER WAY.
  const skip_sim = solo && MEASURED_TURN_GAS_MIST != null
  if (skip_sim) tx.setGasBudget(turn_gas_budget_mist())
  return sign(tx, i18n.t('dungeons.action_commit_turn'), silent, { skip_sim })
}

/**
 * FORFEIT the fight (S-80, §7 — abandon = death): `actions::abandon`, ENGINE. Legal on ANY live
 * fight (world or dungeon room), fight_id/character_id scoped — no RunPass involved. DISTINCT from `abandon_run`
 * below (that one consumes the dungeon RunPass directly, bypassing the Fight/FightOutcome chain entirely — no
 * loot); this one dies INSIDE the fight through the ordinary damage write, so normal settlement
 * (settle_and_destroy → FightOutcome → FightResult) still runs and still rolls loot, same as any other death.
 */
export async function abandon_fight(
  /** @type {string} */ fight_id,
  /** @type {string} */ character_id,
  /** @type {boolean} */ silent = false
) {
  const sdk = await get_sdk()
  const fight_arg = (await ensure_fight_shared_ref(sdk, fight_id)) ?? fight_id
  const tx = abandon_fight_ptb(ctx_of(sdk))({ fight_id: fight_arg, character_id })
  return sign(tx, i18n.t('dungeons.action_abandon_fight'), silent)
}

// ╔═══ [ SETTLEMENT — outcome → result → loot → rebate (mint_rolled/burn_result moved out; mint_all_and_burn stays) ] ═ ]

/**
 * ONE-TX settle+open (closes the settle→open stranded-outcome gap): settlement + result-open compose in a SINGLE
 * atomic PTB, so a terminal fight either FULLY settles AND opens (fight deleted, my `FightOutcome` minted+consumed,
 * `FightResult` minted, XP/HP written back, fight_marker CLEARED) or NOTHING happens (the fight stays live, cleanly
 * retriable) — there is no window where the fight settled but the marker never cleared (the old two-tx brick).
 *   WORLD (no run_pass_id): `settle_open_world_ptb` — settle_and_take → open_taken.
 *   DUNGEON (run_pass_id):  settle_and_take → `dungeon::settle_run`(&outcome HANDLE) → open_taken (&Random LAST);
 *                           settle_run advances the room on victory / consumes the pass on defeat|last-room.
 * The &Random open leg is dry-run + budget-pinned (sim ×1.5, refuse over the 0.1 SUI ceiling) by the ONE tx choke
 * `sign` rides (src/tx) — never a guessed constant. `character_id` = the caller's seat; `open` kiosk-borrows it,
 * so we resolve the kiosk that HOLDS it, never kiosk[0] (a multi-kiosk wallet would 0x2::kiosk abort 11). SILENT:
 * the settlement chain signs with no toast (the recap/card is the surface). kiosk_resolve.js.
 * @param {{ fight_id:string, fight_scope_id:string, run_pass_id?:string|null, world_id?:string|null,
 *   character_id:string, lost_group?:{world_id:string,zx:number,zy:number,index:number}|null }} args
 *   `fight_scope_id` is the Fight's OWN `world` field — what picks its registry shard. For a dungeon room that
 *   is the CREATOR's RunPass, so it is NOT `world_id` and never defaults to it. `lost_group` = the claimed mob
 *   group a DEFEATED open-world fight gives back (#609); null on a victory (the door refuses a won outcome).
 * @returns {Promise<{ receipt:any, result_id:string|null, xp_share:number|null, loot_units:number|null, final_hp:number|null }>} the ResultOpened event fields (opened_result_of)
 */
export async function settle_and_open({
  fight_id,
  fight_scope_id,
  run_pass_id = null,
  world_id = null,
  character_id,
  lost_group = null,
}) {
  assert_fight_scope(fight_scope_id, 'settle_and_open')
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in your kiosk')
  const ctx = ctx_of(sdk)
  let tx
  if (run_pass_id) {
    // DUNGEON: settle_and_take yields the outcome HANDLE → settle_run BORROWS it (&FightOutcome) → open_taken
    // CONSUMES it BY VALUE with the terminal &Random LAST. Order pinned (Sui Random-PTB rule).
    const { tx: chained, outcome } = settle_and_take_ptb(ctx)({ fight_id, character_id })
    settle_run_taken_ptb(ctx)({
      run_pass_id,
      outcome,
      world_id,
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      tx: chained,
    })
    tx = open_taken_ptb(ctx)({
      outcome,
      character_id, // picks the latch shard released at result-open — keyed by the character, not the scope
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      tx: chained,
    })
  } else {
    // WORLD: the SDK's plain two-call compose (settle_and_take → open_taken).
    // `lost_group` is DATA, not a flag (#609): present ⇒ the party LOST and this is the group to give back, so
    // the SDK composes settle → release_group → open; absent ⇒ a victory, which has no group to release.
    tx = settle_open_world_ptb(ctx)({
      fight_id,
      character_id,
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      lost_group,
    })
  }
  clear_budget_cache() // FIGHT END (result open) — the fight's act shapes are dead; drop their cached budgets
  clear_fight_ref_cache() // + its pinned shared-ref (the Fight is being destroyed)
  clear_gas_coin_cache() // + the chained gas-coin pin (the fight's commit chain is done)
  const receipt = await sign(tx, i18n.t('fights.action_open_result'), true)
  return { receipt, ...opened_result_of(receipt) }
}

/**
 * DUNGEON settle chain (§9, ONE PTB): `dungeon::settle_run` (BORROWS the outcome — victory advances the room /
 * defeat+last-room consume the pass) THEN `results::open` (CONSUMES the outcome, rolls loot, terminal &Random).
 * Random-terminal legal: settle_run precedes the one &Random call.
 * @param {{ run_pass_id:string, outcome_id:string, world_id?:string|null, character_id:string,
 *   automated?:boolean }} args
 *   character_id = outcome.character — `open` kiosk-borrows it, so the kiosk MUST be the one holding it.
 *   `automated` (#1383) puts the submission under the spend guard's per-outcome circuit + backoff.
 * @returns {Promise<{ receipt:any, result_id:string|null, xp_share:number|null, loot_units:number|null, final_hp:number|null }>} the ResultOpened event fields (opened_result_of)
 */
export async function settle_run_and_open({ run_pass_id, outcome_id, world_id, character_id, automated = false }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  // results::open kiosk-borrows outcome.character to write back XP/HP + clear the fight_marker — the passed kiosk
  // MUST hold THIS character. any_personal_kiosk picked kiosk[0] → 0x2::kiosk::borrow_mut abort 11 EItemNotFound
  // on any wallet whose first cap ≠ the character's kiosk (a real live brick). DERIVE it (kiosk_resolve.js).
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in your kiosk')
  const ctx = ctx_of(sdk)
  // Compose on ONE shared tx: settle_run first (borrows &FightOutcome), open second (consumes it; &Random LAST).
  const tx = settle_run_ptb(ctx)({
    run_pass_id,
    outcome_id,
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
  })
  open_result_ptb(ctx)({
    outcome_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    tx,
  })
  clear_budget_cache() // FIGHT END (result open) — the fight's act shapes are dead; drop their cached budgets
  clear_fight_ref_cache() // + its pinned shared-ref (the Fight is being destroyed)
  clear_gas_coin_cache() // + the chained gas-coin pin (the fight's commit chain is done)
  const receipt = await sign(tx, i18n.t('fights.action_open_result'), true, null, {
    intent: result_open_intent(outcome_id),
    automated,
  })
  return { receipt, ...opened_result_of(receipt) }
}

/**
 * OPEN a WORLD-fight `FightOutcome` (no run to settle): `results::open` alone — consumes the outcome, mints my
 * soulbound `FightResult` with the rolled loot checklist + XP/HP write-backs (terminal &Random).
 * `character_id` = outcome.character — `open` kiosk-borrows it, so we MUST pass the kiosk that holds it.
 * `automated` (#1383) puts the submission under the spend guard's per-outcome circuit + backoff.
 * @returns {Promise<{ receipt:any, result_id:string|null, xp_share:number|null, loot_units:number|null, final_hp:number|null }>} the ResultOpened event fields (opened_result_of)
 */
export async function open_outcome(
  /** @type {string} */ outcome_id,
  /** @type {string} */ character_id,
  /** @type {boolean} */ automated = false
) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  // Same trap as settle_run_and_open: open kiosk-borrows outcome.character (XP/HP + fight_marker::clear). Pass the
  // kiosk that HOLDS this character, never kiosk[0] (multi-kiosk wallet → abort 11 EItemNotFound). kiosk_resolve.js.
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in your kiosk')
  const tx = open_result_ptb(ctx_of(sdk))({
    outcome_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
  })
  clear_budget_cache() // FIGHT END (result open) — the fight's act shapes are dead; drop their cached budgets
  clear_fight_ref_cache() // + its pinned shared-ref (the Fight is being destroyed)
  clear_gas_coin_cache() // + the chained gas-coin pin (the fight's commit chain is done)
  const receipt = await sign(tx, i18n.t('fights.action_open_result'), true, null, {
    intent: result_open_intent(outcome_id),
    automated,
  })
  return { receipt, ...opened_result_of(receipt) }
}

/**
 * ATOMIC loot settle (recurring abort-105, 07-11 — THE structural fix): mint EVERY rolled template AND
 * burn the emptied `FightResult` in ONE PTB. `mint_rolled` borrows `&mut result` per template; `burn_result`
 * consumes it BY VALUE as the LAST command — the canonical Sui &mut-then-move pattern over ONE owned-object INPUT
 * (`tx.object(result_id)` dedupes, so every command shares the same input). Both are `entry`, but the result is a
 * PTB INPUT, not a prior-command RESULT, so the "entry cannot consume a prior command's result" rule never bites
 * (that rule forced `open_taken` to be a public twin — results.move); neither call draws `&Random`, so the burn
 * is legal last. The burn's on-chain `assert!(rolled.is_empty())` (results.move:170) runs AFTER every mint's
 * `take_rolled` in the SAME tx — so CHAIN truth gates the burn, never a client read. If ANY mint aborts the WHOLE
 * PTB reverts: no burn, loot stays on the result, cleanly retriable. This kills the entire staleness class the
 * old two-phase flow (read → mint×N → a SEPARATE burn gated by client `all_minted` bookkeeping) carried — a
 * degraded `get_fight_result` read could leave `all_minted` vacuously true and fire the burn against a full
 * result. Empty `templates` composes a bare burn (a defeat, or a result already emptied by a prior attempt).
 * @param {string} result_id @param {string[]} templates the DISTINCT rolled item_template ids to mint
 * @returns {Promise<{ receipt: any, kiosk_id: string, kiosk_cap_id: string }>} the authoritative mint receipt
 *   plus the exact destination handle needed to hydrate its created Item rows
 */
export async function mint_all_and_burn(/** @type {string} */ result_id, /** @type {string[]} */ templates) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  // any personal kiosk is the loot LOCK-TARGET (no character binding — mint_rolled locks each minted item there).
  const handle = await any_personal_kiosk(sdk, address)
  if (!handle) throw new Error('No personal kiosk found')
  const ctx = ctx_of(sdk)
  // Thread ONE tx across every mint then the burn (an undefined `tx` seeds a fresh Transaction via the builder
  // default; each builder returns the same threaded tx). burn_result is composed LAST — the by-value consume.
  let tx
  for (const item_template_id of templates)
    tx = mint_rolled_ptb(ctx)({
      result_id,
      item_template_id,
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      tx,
    })
  tx = burn_result_ptb(ctx)({ result_id, tx })
  const receipt = await sign(tx, i18n.t('dungeons.action_burn'), true)
  // The caller feeds this async outcome back through the inventory reducer door. Threading the resolved kiosk
  // handle avoids a second read and makes each receipt-created row immediately usable, not merely visible.
  return {
    receipt,
    kiosk_id: handle.kiosk_id,
    kiosk_cap_id: handle.personal_kiosk_cap_id,
  }
}
