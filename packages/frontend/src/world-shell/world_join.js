// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-57 — WORLD JOIN actions (supersedes the [J] prompt): joining a world is (1) AUTOMATIC
// right after character creation — MONEY-ROUTED exactly like create: a fresh zkLogin wallet
// (≤ 0.2 SUI) rides the SPONSORED door (sponsor_and_execute_transaction), a FUNDED wallet (> 0.2 SUI, which the
// sponsor refuses by policy) SELF-PAYS the same join; the S-54 choke dry-runs either first, a would-fail join
// burns zero gas — and (2) MANUAL from the world SWITCHER next to the online-players panel (S-67 mounts that
// UI; it calls `join_world_action` — existing characters self-pay through the run_tx choke, an empty wallet
// refuses honestly at the dry-run). SPEC §4: first join rolls spawn+checkpoint; a rejoin restores it.
// Kiosk resolution: THE one derive-from-character home (kiosk_resolve.js) — never a first-cap pick.

import { join_world_ptb } from '@aresrpg/sdk/game'

import { use_auth, sponsor_and_execute_transaction, is_zklogin_session } from '../auth'
import { read_sui_balance_mist } from '../auth/sui_balance'
import { get_sdk } from '../chain/sdk'
import { normalize_receipt } from '../chain/receipt'
import { DEMO_NETWORK, T62_WORLDS } from '../chain/deployment'
import { route_create_payment } from '../chain/money_route'
import { is_sponsor_self_pay_refusal } from '../tx'
import { FINALITY_POLL_SCHEDULE } from '../tx/latency.js'
import { game_log } from '../core/log.js'
import { read_world_joined } from '../game/core/world_joined.js'
import { tx_error } from '../game/core/abort_copy.js'

import { run_tx } from './tx.js'
import { join_kiosk_for_character } from './kiosk_resolve.js'
import { publish_world_binding } from './session_gate.js'
import { seed_checkpoint_spawn } from './world_checkpoint.js'

/**
 * A KNOWN-EXECUTED sponsored join's events-only receipt, read straight off its digest (the station response
 * carries no events — SponsoredReceipt, auth/index.ts — but the station "already waited for finality" per its
 * own contract, so this is a direct read of ALREADY-DURABLE data, never a poll-and-hope: the SAME
 * waitForTransaction call world-shell/tx.js's run_tx already uses for the self-pay path). A failure here is
 * silent-safe — resolve_checkpoint_spawn's chain-direct DF read stays the fallback net.
 * @param {string} digest @returns {Promise<any|null>}
 */
async function fetch_join_events(digest) {
  if (!digest) return null
  try {
    const sdk = await get_sdk()
    const raw = await sdk.grpc_client.core.waitForTransaction({
      digest,
      include: { events: true },
      pollSchedule: FINALITY_POLL_SCHEDULE,
    })
    return normalize_receipt(raw)
  } catch (error) {
    game_log('world-join', 'join receipt event fetch failed — checkpoint stays on the chain-direct DF read', error)
    return null
  }
}

/**
 * PIPELINE LAW fast path: decode `WorldJoined` off the join receipt and ferry the PROVEN chain position into
 * world_checkpoint.js's boot-spawn cache immediately — before the caller publishes the world binding (which is
 * what wakes GameWorldHost's separate, racy chain-direct re-read). A decode miss is silent-safe (older package /
 * no events / receipt shape gap) — the existing chain-direct read remains the fallback, unchanged behavior.
 * @param {string} character_id @param {string} world_id @param {any} result normalized receipt (or null)
 */
async function seed_from_join_receipt(character_id, world_id, result) {
  const joined = read_world_joined(result)
  if (!joined) return
  await seed_checkpoint_spawn(character_id, world_id, { x: joined.x, z: joined.z })
}

/** Build the `zones::join_world` PTB for `character_id` with the create-effects-first kiosk pair. */
async function build_join(character_id, world_id) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const sdk = await get_sdk()
  // Create-effects FIRST (a just-minted character's kiosk pair is known EXACTLY — zero reads, zero race), else the
  // derive-from-character resolver with a bounded READ-ONLY retry (never the join tx). See kiosk_resolve.js.
  const handle = await join_kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in one of your kiosks')
  return join_world_ptb({ network: DEMO_NETWORK })({
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
  })
}

/** Per-session once-per-character latch — the auto-join NEVER re-fires for a character this session (an
 *  executed failure included: digest = gas burned = no auto-retry; the switcher is the manual retry). */
const auto_attempted = new Set()

/** Characters whose player made an EXPLICIT manual travel this session. The ghost-world auto-healer
 *  (auto_join_world → First Shore) must DEFER to a chosen world: once this holds a character, the healer
 *  neither fires nor lets an in-flight heal clobber the chosen binding — a manual join to any LIVING world is
 *  legitimate and must win. Session-scoped (the healer is too); keyed by character id. */
const manual_travel = new Set()

/**
 * MANUAL world join — the switcher's tx (S-67 mounts the UI; this is the callable). Self-pay through the ONE
 * run_tx choke (simulate-first; an executed failure is the caller's to surface, never re-fired).
 * @param {{ character_id: string, world_id?: string, queued?: boolean }} args
 * @returns {Promise<{ result:any, timing:any }>}
 */
export async function join_world_action({ character_id, world_id = T62_WORLDS[0].id, queued = false }) {
  // The player EXPLICITLY chose a world — the ghost-healer must defer. Record the choice (blocks a fire AND a
  // clobber below) and spend the auto-join latch so a not-yet-fired heal becomes a no-op. The switcher lists
  // only LIVING worlds, so a manual travel always lands the character on a live world (the healer's purpose).
  manual_travel.add(character_id)
  auto_attempted.add(character_id)
  const tx = await build_join(character_id, world_id)
  const out = await run_tx('join_world', tx, undefined, undefined, { queued })
  // PIPELINE LAW fast path: the tx's OWN receipt already proves the position (first-join roll, or the
  // untouched rejoin checkpoint — zones.move emits WorldJoined either way) — seed it before publishing so a
  // travel/rejoin never races the separate chain-direct DF read (world_checkpoint.js).
  await seed_from_join_receipt(character_id, world_id, out.result)
  // The bind is chain-truth NOW — publish it so the session gate swaps spectate → resident without waiting
  // on the next doc poll (session_gate.js is the one binding home; the indexer catches up behind it). Source
  // 'manual' arms the stale-poll guard: a doc poll returning the pre-travel world during indexer catch-up gets
  // discarded instead of clobbering this write (session_gate.js's _pending_manual_target).
  publish_world_binding(character_id, world_id, 'manual')
  return out
}

/**
 * AUTO-JOIN: fire the money-routed join (funded > 0.2 SUI self-pays, empty sponsors) for a
 * character with NO world binding — the post-create seam (a fresh character always lands world-less) and the
 * legacy-unjoined heal, one affordance-less flow.
 * Idempotent per session; resolves false when skipped, true when the join landed.
 * @param {{ character_id: string, world_id?: string }} args
 */
export async function auto_join_world({ character_id, world_id = T62_WORLDS[0].id }) {
  // DEFER to an explicit manual travel: if the player already chose a world this session, the ghost-healer must
  // NOT fire First Shore over it. auto_attempted also latches the once-per-session no-retry law.
  if (!character_id || auto_attempted.has(character_id) || manual_travel.has(character_id)) return false
  auto_attempted.add(character_id) // latch BEFORE the send — a failure never auto-retries (tx-retry law)
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) return false

  // Self-pay the SAME join PTB through the ONE run_tx choke (simulate-first; throws on on-chain failure) — the
  // exact path the MANUAL switcher (join_world_action) already uses, so join_world is proven self-payable. A
  // fresh build per attempt (a PTB is consumed once by its sponsored build). run_tx's own receipt already
  // carries events (tx.js DEFAULT_INCLUDE) — seed the checkpoint cache off it before returning (pipeline law).
  const self_pay = async () => {
    const { result, timing } = await run_tx('join_world', await build_join(character_id, world_id))
    await seed_from_join_receipt(character_id, world_id, result)
    return timing.digest
  }

  // SPONSORED attempt with a BALANCE-RULE reactive fallback: if the wallet crossed 0.2 SUI between our fresh read
  // and the sponsor's (a funded wallet was always meant to self-pay), the sponsor's tagged "self-pay-required" 400
  // (PRE-execution, no digest, zero gas) silently self-pays the SAME join instead of dead-ending. ANY other sponsor
  // error — the daily free-tier cap INCLUDED (never auto-spend past the "free" promise), plus auth /
  // drained pool / on-chain abort — rethrows untouched to surface honestly (the discovery caller shows one toast).
  const sponsored_join = async () => {
    try {
      const res = await sponsor_and_execute_transaction(wallet_name, address, await build_join(character_id, world_id))
      // ISSUE #22 sweep: a bare `new Error(res.effects.status.error)` here coerced the STRUCTURED gRPC/station
      // abort object to the literal string "[object Object]" — to_message_string's own guard then discards it,
      // so a MAPPED abort (zones/version/config…) silently degraded to the generic fallback instead of its
      // specific copy. Route through the ONE decoder home so a mapped code keeps its exact player copy; digest
      // presence (station contract: '' ⇒ pre-flight refusal, zero gas) drives the honesty split.
      if (res?.effects?.status?.status !== 'success')
        throw tx_error(res?.effects?.status?.error ?? 'join_world failed on-chain', { preflight: !res?.digest })
      // The station's receipt carries no events (SponsoredReceipt) — fetch them by the now-known digest and
      // seed the checkpoint cache (pipeline law: predict/carry the receipt-proven position, never leave the
      // engine boot to race the separate DF read). Silent-safe: a fetch/decode miss keeps the old behavior.
      const events_result = await fetch_join_events(res.digest)
      await seed_from_join_receipt(character_id, world_id, events_result)
      return res.digest
    } catch (error) {
      if (!is_sponsor_self_pay_refusal(error)) throw error
      game_log('world-join', 'sponsor declined (self-pay-required) — self-paying the join')
      return self_pay()
    }
  }

  // MONEY ROUTE (mirrors create's execute_create_routed — design ruling 2026-07-10, 400 fix): the @server sponsor REFUSES a
  // wallet holding > 0.2 SUI (api/sponsor.mjs SELF_PAY_MIST), so a funded zkLogin player must SELF-PAY the join
  // rather than dead-ending on a "self-pay-required" 400. A FRESH on-chain read decides the door; a read failure
  // (null) defaults to SPONSORED because the reactive fallback above still catches a funded 400 (never a dead end).
  // MONEY LAW (#73): only a zkLogin (Enoki) identity is sponsor-eligible — a CONNECTED WALLET self-pays
  // EVERY tx and never rides the sponsor door regardless of balance. A funded zkLogin wallet (> 0.2 SUI)
  // self-pays too; a low-balance zkLogin wallet goes sponsored (the reactive fallback above still catches a
  // funded 400). A read failure (null) leaves a zkLogin wallet on the sponsored default (fallback-safe).
  const balance_mist = await read_sui_balance_mist(address)
  const must_self_pay =
    !is_zklogin_session() || (balance_mist != null && route_create_payment(balance_mist) === 'self_pay')
  const digest = must_self_pay ? await self_pay() : await sponsored_join()

  // DEFER to a manual travel that raced this in-flight heal: if the player picked a world while we were sending,
  // DO NOT clobber their chosen binding with First Shore (their explicit join wins). The heal tx already landed
  // on-chain, but the manual travel published + out-writes it; we just don't advertise a superseded migration
  // (return false → the caller shows no world_migrated toast, no refetch).
  if (manual_travel.has(character_id)) {
    game_log('world-join', `auto-join landed (${digest}) but a manual travel superseded — not clobbering the choice`)
    return false
  }
  // Chain-truth publish: the session gate swaps spectate → resident THIS tick (once the character
  // has joined, the player enters the world truly); the doc poll + roster refresh converge behind it. Source
  // 'manual' arms the same stale-poll guard as the switcher's join (session_gate.js's _pending_manual_target).
  publish_world_binding(character_id, world_id, 'manual')
  game_log('world-join', `auto-join landed (${digest}) — entering the world`)
  return true
}
