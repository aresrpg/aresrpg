// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board #49 (FIGHT — LIQUIDATION clause) on the S-46 ENGINE: the post-deadline janitors are PUBLIC
// and the app EMBODIES them — EVERY client watching a fight auto-fires the permissionless door the moment it
// observes an expired on-chain deadline, so a fight can never wedge on an away player:
//   ACTIVE + turn deadline passed      → `turns::crank`       (forfeits the overdue turn, resolves forward)
//   PLACEMENT + window deadline passed → `turns::force_start`  (readies every living seat, flips ACTIVE)
//
// GUARDS: a random JITTER (0–MAX_JITTER_MS) + SINGLE-FLIGHT per client per distinct deadline, so N
// watchers never stack N txs. EXECUTED-FAILURE LATCH (S-57, the tx-retry burn law): a tx that EXECUTED and
// failed (a digest exists — MoveAbort: a racing janitor won, the deadline advanced) is NEVER auto-retried for
// the SAME deadline — the dedup stays consumed; a FRESH deadline (the turn genuinely advanced) is a new key
// and re-arms naturally. Only a PRE-FLIGHT failure (network/sign — no digest, no gas burned) re-arms.
//
// TX TRANSPARENCY (M3 wiring row — supersedes the earlier silent-bystander clause): these are
// real signed txs spending THIS wallet's gas, so each fire announces itself through the one toast home
// ("I should see every transaction happening"). The jitter + single-flight + per-deadline dedup already cap
// it at one toast per distinct deadline. CHAIN-AUTHORSHIP LAW: real signed txs, never p2p messages.

import { decode_fight } from '@aresrpg/sdk/fight'

import { game_log } from '../core/log.js'
import { get_sdk } from '../chain/sdk'
import i18n from '../i18n'
import { push_event_toast } from '../game/core/toast.js'

import { crank as tx_crank, force_start as tx_force_start } from './dungeon_actions'
import { read_object } from './run_reads.js'

const STATUS_ACTIVE = 1
const STATUS_PLACEMENT = 5
const MAX_JITTER_MS = 1500

let in_flight = false
let fired_for_deadline = /** @type {number | null} */ (null)
let force_in_flight = false
let force_fired_for_deadline = /** @type {number | null} */ (null)

/** A tx failure that EXECUTED on-chain (digest exists — gas burned). dungeon_actions' sign() throws the
 *  humanized MoveAbort via tx_error(), whose `.cause` carries the structured abort; a pre-flight/network
 *  failure has no cause and usually no Move context. Conservative: treat a `.cause`-carrying error OR an
 *  explicit Move abort text as EXECUTED (latch); everything else as pre-flight (re-arm). */
const executed_failure = (/** @type {any} */ error) =>
  Boolean(error?.cause) || /MoveAbort|abort|EInvalid|ENot|deadline/i.test(String(error?.message ?? ''))

/** The active turn's on-chain deadline has passed (and there IS a live turn to liquidate). */
const expired = (/** @type {any} */ v) =>
  !!v && v.status === STATUS_ACTIVE && v.turn_deadline_ms > 0 && Date.now() >= v.turn_deadline_ms

/** The PLACEMENT window's deadline has passed (and we're still in placement → force_start is eligible). */
const placement_expired = (/** @type {any} */ v) =>
  !!v && v.status === STATUS_PLACEMENT && v.placement_deadline_ms > 0 && Date.now() >= v.placement_deadline_ms

/**
 * LIQUIDATION probe — call once per poll with the freshly-adapted view (dungeon_store.refresh). Schedules a
 * jittered, single-flight `crank` when the active turn's deadline passed; self-dedupes on the deadline.
 * @param {any} view the adapted fight view @param {() => { dungeon: any, busy: boolean, refresh: () => Promise<void> }} get
 */
export function maybe_liquidate(view, get) {
  maybe_force_start(view, get)
  if (!expired(view) || in_flight || fired_for_deadline === view.turn_deadline_ms) return
  const deadline = view.turn_deadline_ms
  const fight_id = view.id
  fired_for_deadline = deadline
  in_flight = true
  setTimeout(
    async () => {
      try {
        // Re-check the LIVE store at fire time: the turn may have advanced during the jitter, or a local tx is
        // mid-flight — skip, no wasted gas. D169: a SKIP must not consume the dedup (re-arm; jitter+in_flight
        // still prevent spam).
        const s = get()
        if (
          s.busy ||
          !s.dungeon ||
          s.dungeon.id !== fight_id ||
          s.dungeon.turn_deadline_ms !== deadline ||
          !expired(s.dungeon)
        ) {
          if (s.dungeon?.turn_deadline_ms === deadline) fired_for_deadline = null
          return
        }
        // TX TRANSPARENCY: the liquidation crank is a real signed tx — one honest info toast.
        push_event_toast({ state: 'info', title: i18n.t('dungeons.auto_crank_fired') })
        await tx_crank(fight_id, true)
        await get().refresh()
      } catch (error) {
        if (executed_failure(error)) {
          // EXECUTED abort (a racing janitor won / the deadline advanced) — gas burned once; NEVER re-fire for
          // this same deadline (latch law). A fresh deadline re-arms by key change.
          if (import.meta.env?.DEV)
            game_log(
              'liquidation',
              'crank executed-abort — latched for this deadline',
              /** @type {any} */ (error)?.message
            )
        } else {
          if (import.meta.env?.DEV)
            game_log('liquidation', 'crank pre-flight failure — re-armed', /** @type {any} */ (error)?.message)
          fired_for_deadline = null
        }
      } finally {
        in_flight = false
      }
    },
    Math.floor(Math.random() * MAX_JITTER_MS)
  )
}

/**
 * PLACEMENT FORCE-START probe (D110 sibling): schedules a jittered, single-flight `force_start` when the
 * placement window's deadline passed. Same guards + the same executed-failure latch.
 * @param {any} view @param {() => { dungeon: any, busy: boolean, refresh: () => Promise<void> }} get
 */
export function maybe_force_start(view, get) {
  if (!placement_expired(view) || force_in_flight || force_fired_for_deadline === view.placement_deadline_ms) return
  const deadline = view.placement_deadline_ms
  const fight_id = view.id
  force_fired_for_deadline = deadline
  force_in_flight = true
  setTimeout(
    async () => {
      try {
        const s = get()
        if (
          s.busy ||
          !s.dungeon ||
          s.dungeon.id !== fight_id ||
          s.dungeon.placement_deadline_ms !== deadline ||
          !placement_expired(s.dungeon)
        ) {
          if (s.dungeon?.placement_deadline_ms === deadline) force_fired_for_deadline = null
          return
        }
        // TX TRANSPARENCY: the placement force-start is a real signed tx — announce it.
        push_event_toast({ state: 'info', title: i18n.t('dungeons.auto_force_start_fired') })
        await tx_force_start(fight_id, true)
        await get().refresh()
      } catch (error) {
        if (executed_failure(error)) {
          if (import.meta.env?.DEV)
            game_log(
              'liquidation',
              'force_start executed-abort — latched for this window',
              /** @type {any} */ (error)?.message
            )
        } else {
          if (import.meta.env?.DEV)
            game_log('liquidation', 'force_start pre-flight failure — re-armed', /** @type {any} */ (error)?.message)
          force_fired_for_deadline = null
        }
      } finally {
        force_in_flight = false
      }
    },
    Math.floor(Math.random() * MAX_JITTER_MS)
  )
}

/** Reset single-flight state on session teardown so a later fight starts clean. */
export function reset_liquidation() {
  in_flight = false
  fired_for_deadline = null
  force_in_flight = false
  force_fired_for_deadline = null
}

// ── BOOT-RESUME PRESENTABILITY (REJOIN-SPAWN root, 2026-07-17) ──────────────────────────────────────────────
// A character rejoining a world while a ZOMBIE world fight (PLACEMENT, window expired — left by a dead
// session) was still on-chain got its boot HIJACKED: the one-shot resume adopted the session as-is, the first
// snapshot flipped the fight-view edge (`fight_mode`), and the roam self rig/SelfPlate unmounted with no
// presentable board behind them (a "spectate view"). The resume must adopt ONLY a fight the phase
// machine can present — an expired window goes through the SAME permissionless `force_start` door this module
// already embodies, BEFORE adoption. This is that policy's one home (world_fight.js stays a thin shim).

/**
 * PURE — presentability of a chain-read fight for a boot resume.
 * `enter` = presentable now (ACTIVE, or PLACEMENT inside its window — a genuine mid-fight/mid-placement
 * refresh) · `liquidate` = expired placement, needs the `force_start` heal first · `skip` = never adopt
 * (terminal/unknown/unreadable — the pending-outcome recovery/receipt flows own any marker discharge).
 * @param {{ status?: number, placement_deadline_ms?: bigint|number|null } | null} decoded
 * @param {number} now
 * @returns {'enter'|'liquidate'|'skip'}
 */
export function placement_resume_decision(decoded, now) {
  if (!decoded) return 'skip' // unreadable fight — never adopt on hope; a later boot pass retries
  const status = Number(decoded.status)
  if (status === STATUS_ACTIVE) return 'enter' // advanced under us (a racing janitor/join) — genuinely live
  if (status !== STATUS_PLACEMENT) return 'skip' // terminal/unknown — nothing a live session can present
  const deadline = Number(decoded.placement_deadline_ms ?? 0)
  if (!deadline || now < deadline) return 'enter' // window open (or windowless, defensive) — a real refresh
  return 'liquidate'
}

/**
 * Chain-truth gate for a /v1 'placement' resume candidate (the /v1 fight doc carries NO placement deadline —
 * only the Fight object does). Expired window → fire `force_start` FIRST (silent, the embodiment law above):
 * a certified force_start is RECEIPT TRUTH the fight is ACTIVE → enter. A refusal re-reads once and defers
 * honestly — never re-fired this pass (tx-retry burn law; a raced janitor may already have advanced it).
 * @param {string} fight_id @param {(fight_id: string, silent: boolean) => Promise<any>} [force_start_door]
 * @returns {Promise<'enter'|'skip'>}
 */
export async function ensure_resumable_placement(fight_id, force_start_door = tx_force_start) {
  const read_decoded = async () => {
    try {
      return decode_fight((await read_object(await get_sdk(), fight_id))?.json)
    } catch (error) {
      game_log('world-fight', 'resume placement read failed — no reconnect this pass', error)
      return null
    }
  }
  const decision = placement_resume_decision(await read_decoded(), Date.now())
  if (decision !== 'liquidate') return decision
  try {
    await force_start_door(fight_id, true) // silent janitor tx — certified ⇒ the fight IS active now
    return 'enter'
  } catch (error) {
    game_log('world-fight', 'boot liquidation (force_start) did not land — resume deferred', error)
    const after = placement_resume_decision(await read_decoded(), Date.now())
    return after === 'liquidate' ? 'skip' : after // never loop a refused liquidation
  }
}
