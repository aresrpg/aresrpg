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

import { decode_fight, fight_status_label } from '@aresrpg/sdk/fight'
import { STATUS_PLACEMENT as VIEW_STATUS_PLACEMENT } from '@aresrpg/fight/board_state'

import { game_log } from '../core/log.js'
import { get_sdk } from '../chain/sdk'
import i18n from '../i18n'
import { push_event_toast } from '../game/core/toast.js'

import { crank as tx_crank, force_start as tx_force_start } from './dungeon_actions'
import { is_gone_error, read_object } from './run_reads.js'
import { turn_liquidatable } from './fight_expiry_gate.js'
import { CHAIN_STATUS_ACTIVE, CHAIN_STATUS_PLACEMENT } from './fight_chain_status.js'

// TWO NAMESPACES LIVE IN THIS FILE, and they disagree on placement (#932) — so NEITHER is spelled here, both
// are imported from their one home. The janitor probes below are fed an ADAPTED BOARD VIEW (dungeon_store.refresh
// → @aresrpg/fight/board_state, placement 5); the boot-resume gate at the bottom reads a RAW CHAIN decode
// (fight_chain_status.js, placement 0). ACTIVE is 1 in both, which is why mixing them stays invisible until a
// placement fight shows up.
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

/** The active turn's on-chain deadline has passed (and there IS a live turn to liquidate) — fight_expiry_gate.js
 *  is its ONE home now: the player-facing "this fight cannot advance" surface reads the SAME predicate (#882). */
const expired = (/** @type {any} */ v) => turn_liquidatable(v)

/** The PLACEMENT window's deadline has passed (and we're still in placement → force_start is eligible). */
const placement_expired = (/** @type {any} */ v) =>
  !!v && v.status === VIEW_STATUS_PLACEMENT && v.placement_deadline_ms > 0 && Date.now() >= v.placement_deadline_ms

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
        // The overdue-turn crank is silent machinery (owner ruling 2026-07-22): it forfeits an away player's
        // expired turn and resolves the fight forward — never player-facing news, so it fires WITHOUT a toast.
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

// ── BOOT-RESUME PRESENTABILITY (REJOIN-SPAWN root, 2026-07-17 · widened to ACTIVE by #882) ─────────────────
// A character rejoining a world while a ZOMBIE world fight (PLACEMENT, window expired — left by a dead
// session) was still on-chain got its boot HIJACKED: the one-shot resume adopted the session as-is, the first
// snapshot flipped the fight-view edge (`fight_mode`), and the roam self rig/SelfPlate unmounted with no
// presentable board behind them (a "spectate view"). The resume must adopt ONLY a fight the phase
// machine can present — an expired window goes through the SAME permissionless door this module already
// embodies, BEFORE adoption. This is that policy's one home (world_fight.js stays a thin shim).
//
// #882 widened it to the ACTIVE sibling: a re-entry used to adopt ANY 'active' fight blind, including one whose
// TURN deadline expired hours earlier — the zombie that re-captured the character session after session. The
// same rule now covers both live statuses, each through its own janitor door: PLACEMENT→`force_start`,
// ACTIVE→`crank`. What the chain reports AFTER that door decides adoption; a fight the door resolved terminal
// is `gone` (route out + recover the outcome), never a board to mount.

/**
 * PURE — presentability of a CHAIN-read fight for a boot resume (statuses per fight_chain_status.js, NOT the
 * board-view scalars the janitor probes above are fed).
 * `enter` = presentable now (ACTIVE inside its turn deadline, or PLACEMENT inside its window — a genuine
 * mid-fight/mid-placement refresh) · `force_start`/`crank` = live but expired, needs THAT permissionless heal
 * first · `skip` = never adopt (terminal/unknown/unreadable — the pending-outcome recovery/receipt flows own
 * any marker discharge).
 * @param {{ status?: number, placement_deadline_ms?: bigint|number|null,
 *           turn_deadline_ms?: bigint|number|null } | null} decoded
 * @param {number} now
 * @returns {'enter'|'force_start'|'crank'|'skip'}
 */
export function resume_decision(decoded, now) {
  if (!decoded) return 'skip' // unreadable fight — never adopt on hope; a later boot pass retries
  const status = Number(decoded.status)
  if (status === CHAIN_STATUS_ACTIVE) return turn_liquidatable(decoded, now) ? 'crank' : 'enter'
  if (status !== CHAIN_STATUS_PLACEMENT) return 'skip' // terminal/unknown — nothing a live session can present
  const deadline = Number(decoded.placement_deadline_ms ?? 0)
  if (!deadline || now < deadline) return 'enter' // window open (or windowless, defensive) — a real refresh
  return 'force_start'
}

/** What the chain said, in one clause — the REASON a refusal carries out (#932: a refusal that cannot say why
 *  is the silent strand). Diagnostics only: the SDK owns the labels, and the scalar rides along so a namespace
 *  mix-up is legible at a glance. @param {{ readable: boolean, decoded: any }} read */
const chain_reason = ({ readable, decoded }) => {
  if (!readable) return 'the fight object was unreadable this pass'
  if (!decoded) return 'the fight object no longer exists on chain'
  return `chain status ${fight_status_label(decoded.status)} (${Number(decoded.status)})`
}

/**
 * Chain-truth gate for a /v1 resume candidate (the /v1 fight doc carries NO deadlines — only the Fight object
 * does). Expired → fire that status's permissionless door FIRST (silent, the embodiment law above), then let
 * the RE-READ decide: still live ⇒ enter (the board mounts, and an ACTIVE fight the crank could not advance
 * mounts with its honest expired surface + the forfeit exit), terminal/destroyed ⇒ `gone` (the caller routes
 * out and recovers the outcome), unreadable/refused-placement ⇒ `skip` (defer, never loop a refused door).
 * Each door fires at most ONCE per pass — the tx-retry burn law; a raced janitor may already have advanced it.
 * The verdict carries its REASON: the caller refuses OUT LOUD or not at all (#932).
 * @param {string} fight_id
 * @param {{ force_start_door?: (fight_id: string, silent: boolean) => Promise<any>,
 *           crank_door?: (fight_id: string, silent: boolean) => Promise<any> }} [doors]
 * @returns {Promise<{ decision: 'enter'|'gone'|'skip', reason: string }>}
 */
export async function ensure_resumable_fight(fight_id, doors = {}) {
  const { force_start_door = tx_force_start, crank_door = tx_crank } = doors
  // A TRANSPORT failure is not news about the fight: it holds for a later boot pass (`unreadable`), never a
  // "your fight was cleared" claim. Only a definitive gone-error or a decoded terminal status is that claim.
  const read_decoded = async () => {
    try {
      const read = await read_object(await get_sdk(), fight_id)
      return read ? { readable: true, decoded: decode_fight(read.json) } : { readable: false, decoded: null }
    } catch (error) {
      if (is_gone_error(error)) return { readable: true, decoded: null } // destroyed — settled/swept elsewhere
      game_log('world-fight', 'resume liveness read failed — no reconnect this pass', error)
      return { readable: false, decoded: null }
    }
  }
  const verdict = ({ readable, decoded }) => {
    const decision = resume_decision(decoded, Date.now())
    // `skip` off a READABLE chain = terminal or destroyed: route out and recover the outcome. Off an unreadable
    // one it is exactly what it says — we do not know; hold.
    return decision === 'skip' && !readable ? 'unreadable' : decision
  }
  const first = await read_decoded()
  const decision = verdict(first)
  if (decision === 'enter') return { decision: 'enter', reason: chain_reason(first) }
  // terminal/absent on chain — nothing to mount, an outcome to recover
  if (decision === 'skip') return { decision: 'gone', reason: chain_reason(first) }
  if (decision === 'unreadable') return { decision: 'skip', reason: chain_reason(first) }
  const door = decision === 'crank' ? crank_door : force_start_door
  try {
    await door(fight_id, true) // silent janitor tx
  } catch (error) {
    game_log('world-fight', `boot liquidation (${decision}) did not land — resume deferred`, error)
  }
  const read = await read_decoded()
  const after = verdict(read)
  if (after === 'enter') return { decision: 'enter', reason: chain_reason(read) }
  // the door resolved it terminal (or it vanished) — route out, never mount
  if (after === 'skip') return { decision: 'gone', reason: chain_reason(read) }
  // Still expired after its one door: an ACTIVE board is still PRESENTABLE and holds the working exit (forfeit),
  // so mount it — the expiry gate surfaces the honest state there. A placement window nothing can start is not.
  if (after === 'crank') return { decision: 'enter', reason: chain_reason(read) }
  return { decision: 'skip', reason: `${chain_reason(read)} — its ${decision} door did not land` }
}
