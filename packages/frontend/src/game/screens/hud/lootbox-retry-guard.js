// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// An executed/uncertain loot-box open must not be submitted again while its outcome is unknown. The tx choke
// attaches the digest for the lootbox classes, so an executed failure carries its proof; ambiguity still latches.
// SELF-CLEAR (D1 + P3 receipt-grade): the box latch releases through a PURE predicate over observed chain truth —
// a fresh owner-items read (started strictly AFTER the open promise settled) that still contains the box. But
// bare /v1 presence is NOT trusted as ground truth: a SUCCESSFUL open consumes the box, yet a lagged projection
// may still show it present, and re-enabling a manual open there would burn. So release keys on the RECEIPT: only
// a FAILED open (box provably still sealed) releases; a success NEVER releases (a lingering latch on a consumed
// box is harmless — the bag drops it once /v1 catches up). No timer, no poll: load_roster feeds the read in.
// CLAIMS (D3): collection is automatic (at opening + the boot sweep), so this module is also the ONE
// cross-surface arbiter of claim flights — reveal / sweep / shop can never double-fire the same PetBoxClaim,
// a settled success is never re-fired in-session, and an executed/ambiguous failure latches the claim against
// any AUTO refire (manual one-click retry stays open). The executed-failure claim latch is DURABLE across a
// refresh (P1): mirrored to localStorage so the boot sweep never auto-refires an aborted claim every login.
// Module scope survives drawer remounts; a full page refresh reconciles box latches (session-scoped) but the
// executed-failed CLAIM latch outlives it (the boot sweep is an AUTO gas path — it must).

import { drop_pending_buy } from '@aresrpg/inventory/bought_items_ledger'

import { is_preflight_refusal } from '../../core/abort_copy.js'
import { error_executed_digest } from '../../../world-shell/tx_digest_error.js'

/** @typedef {{ armed_at: number, settled_at: number | null, settled_failed: boolean, digest: string | null }} BoxLatch */

/** @type {Map<string, BoxLatch>} */
let blocked_boxes = new Map()
/** @type {Set<string>} */
let blocked_equip_character_ids = new Set()
/** @type {Set<string>} */
let claims_in_flight = new Set()
/** @type {Set<string>} */
let claims_succeeded = new Set()
/** @type {Set<string>} */
let claims_latched = new Set()

// ── DURABLE CLAIM LATCH (P1) — the executed-failed claim latch survives a refresh/relogin ──────────────────────
// An executed-and-failed claim ROLLS BACK its consumption, so the PetBoxClaim persists in /v1. Module scope resets
// on refresh → without durability the boot sweep re-auto-fires that aborted claim EVERY boot, burning gas with no
// human (a TX-RETRY BURN LAW breach). Executed-failure latches are therefore mirrored to localStorage under a
// one-pipeline shape: storage read at boot is an INPUT (`hydrate_claim_latches`, called at the sweep entry);
// the write is an OUTPUT EFFECT at the EDGE (`persist_claim_latches`, the ONLY writer); the hot-path reducers
// (`sweep_eligible_claims`, `begin_claim`) read only the in-memory set / the derived `latch_durability` flag.
// Only executed failures persist — a zero-gas preflight refusal stays auto-eligible; success/consumption clears it.
//
// DURABILITY GATE (P1 round 3): a swallowed write (Safari private mode, QuotaExceeded, storage disabled) means the
// latch is NOT durable — the AUTO-sweep must then refuse to run rather than create an executed-fail it cannot
// persist (which would silently re-burn every boot). So the edge writer READS BACK every write and, on any
// throw / mismatch, downgrades `latch_durability` to 'unconfirmed'. The auto-sweep gates on 'durable'; when
// unconfirmed, stranded claims degrade to the existing MANUAL one-click path (the shop chip). A missing storage
// API (SSR/test with no stub) is NOT a broken-storage signal and never downgrades — the browser sweep always has it.
const CLAIM_LATCH_STORAGE_KEY = 'ares:lootbox:executed_failed_claims'

/** @type {'durable' | 'unconfirmed'} — derived at boot + downgraded on any persist failure; only the edge writer writes it. */
let latch_durability = 'durable'

/** EDGE (boot input): the ONLY storage reader — the durable executed-failure claim ids, or [] when unavailable. */
function read_persisted_claim_latches() {
  try {
    const raw = globalThis.localStorage?.getItem(CLAIM_LATCH_STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
  } catch {
    return [] // private-mode / SSR / corrupt — the durability gate below turns the auto-sweep off
  }
}

/** EDGE (output effect): the ONLY storage writer. Writes then READS BACK the same key — a swallowed/quota-throwing
 * write leaves durability UNCONFIRMED so the auto-sweep refuses (no un-persistable executed-fail). A missing storage
 * API (SSR/test, no stub) is not a broken-storage signal and leaves durability untouched. @returns {void} */
function persist_claim_latches() {
  const store = globalThis.localStorage
  if (!store) return
  const payload = JSON.stringify([...claims_latched])
  try {
    store.setItem(CLAIM_LATCH_STORAGE_KEY, payload)
    if (store.getItem(CLAIM_LATCH_STORAGE_KEY) !== payload) latch_durability = 'unconfirmed'
  } catch {
    latch_durability = 'unconfirmed'
  }
}

/** Boot INPUT: union the persisted executed-failure latches into the in-memory set, then re-persist to PROBE
 * durability (read-back verify). Idempotent — call at the boot sweep entry so it sees prior sessions' aborted
 * claims and derives whether storage can be trusted before the auto-sweep decides. @returns {void} */
export function hydrate_claim_latches() {
  const persisted = read_persisted_claim_latches()
  if (persisted.length) {
    claims_latched = new Set(claims_latched)
    for (const id of persisted) claims_latched.add(id)
  }
  persist_claim_latches() // boot durability probe — sets latch_durability via the read-back verify
}

/** Whether the executed-fail latch is confirmed durable (the AUTO-sweep gate; the manual path never checks this).
 * A derived flag read by the reducer path, written only by the edge writer. @returns {boolean} */
export function is_latch_durable() {
  return latch_durability === 'durable'
}

/** Arm (or re-arm) the open latch for a box. Idempotent: an existing row keeps its history. @param {string | null | undefined} box_id */
export function block_box_retry(box_id) {
  if (!box_id || blocked_boxes.has(box_id)) return
  blocked_boxes = new Map(blocked_boxes).set(box_id, {
    armed_at: Date.now(),
    settled_at: null,
    settled_failed: false,
    digest: null,
  })
}

/** @param {string | null | undefined} box_id @returns {boolean} */
export function is_box_retry_blocked(box_id) {
  return !!box_id && blocked_boxes.has(box_id)
}

/** The executed-failure proof carried by a latched box (the bag tooltip's cause line). @param {string | null | undefined} box_id */
export function box_retry_digest(box_id) {
  return (box_id && blocked_boxes.get(box_id)?.digest) || null
}

/** Re-arm only a positively identified zero-gas preflight refusal. @param {string | null | undefined} box_id */
export function allow_box_retry(box_id) {
  if (!box_id || !blocked_boxes.has(box_id)) return
  blocked_boxes = new Map(blocked_boxes)
  blocked_boxes.delete(box_id)
}

/**
 * Stamp the open promise SETTLED (resolved or rejected) — the precondition of any release. The FIRST settle wins:
 * its success/failure verdict (P3 receipt-grade) and any executed-failure digest are preserved. Safe on an
 * unlatched id (no-op).
 *
 * PHANTOM-RESURRECTION PURGE (a bag tile stayed badged "Confirming…" forever on a box that had
 * already opened): a shop buy optimistically paints the box before any chain-truth read confirms it
 * (store_patch.hydrate_bought_items → @aresrpg/inventory's add_pending_buy) — that ledger row's ONLY self-drain
 * condition is "a fresh read includes this id" (bought_items_ledger.js). loot_box::open_internal BURNS the exact
 * box_item_id on a SUCCESSFUL open (Move: burn_units destroys the passed object outright, re-minting only a NEW
 * id for any stack remainder), so a box opened before its own buy was ever confirmed can NEVER again appear in a
 * chain-truth read. Without this purge, merge_pending_buys re-injects the phantom row on every future snapshot
 * forever — and since this module's latch keys off the SAME id (P3: success never releases, by design, trusting
 * the tile to vanish), the resurrected tile stays badged permanently. A FAILED settle never purges: REFUSALS-
 * FIRST means the box was never burned, so the ledger's normal self-drain remains correct for it.
 * @param {string | null | undefined} box_id @param {{ at?: number, error?: unknown }} [outcome]
 */
export function note_open_settled(box_id, { at = Date.now(), error } = {}) {
  const row = box_id ? blocked_boxes.get(box_id) : null
  if (!box_id || !row) return
  const already_settled = row.settled_at != null
  if (!already_settled && error == null) drop_pending_buy(box_id)
  blocked_boxes = new Map(blocked_boxes).set(box_id, {
    ...row,
    settled_at: row.settled_at ?? at,
    // P3 receipt-grade: remember whether the FIRST settle FAILED. Only a failed open leaves the box sealed &
    // safely re-openable; a success consumed it and must never re-enable off a lagged /v1 presence.
    settled_failed: already_settled ? row.settled_failed : error != null,
    digest: row.digest ?? error_executed_digest(error),
  })
}

/**
 * PURE release predicate (D1 + P3): a box latch releases only when its open promise settled as a FAILURE (the
 * receipt proves the box is still sealed), the read began strictly AFTER that settle (projection-lag proof), and
 * the box is PRESENT in the fresh read. A SUCCESS never releases — a consumed box that a lagged /v1 still shows
 * present must not re-enable a burning re-open. Absence proves nothing and releases nothing.
 * @param {BoxLatch | null | undefined} row @param {Set<string>} live_box_ids @param {number} read_started_at
 * @param {string} box_id @returns {boolean}
 */
export function should_release_box_latch(row, live_box_ids, read_started_at, box_id) {
  return (
    !!row &&
    row.settled_failed === true &&
    row.settled_at != null &&
    read_started_at > row.settled_at &&
    live_box_ids.has(box_id)
  )
}

/**
 * Data input for the self-clear: called by the roster pipeline when a fresh owner-items read lands.
 * @param {{ live_box_ids: Set<string>, read_started_at: number }} read @returns {string[]} released box ids
 */
export function release_settled_box_latches({ live_box_ids, read_started_at }) {
  const released = [...blocked_boxes.keys()].filter((id) =>
    should_release_box_latch(blocked_boxes.get(id), live_box_ids, read_started_at, id)
  )
  if (released.length) {
    blocked_boxes = new Map(blocked_boxes)
    for (const id of released) blocked_boxes.delete(id)
  }
  return released
}

/** Equip latches only on positive proof that submission produced a digest (gas may already be burned).
 * @param {string | null | undefined} character_id @param {unknown} error @returns {boolean} */
export function block_equip_retry(character_id, error) {
  if (!character_id || !error_executed_digest(error)) return false
  blocked_equip_character_ids = new Set(blocked_equip_character_ids).add(character_id)
  return true
}

/** @param {string | null | undefined} character_id @returns {boolean} */
export function is_equip_retry_blocked(character_id) {
  return !!character_id && blocked_equip_character_ids.has(character_id)
}

/** A successful underlying-state refresh makes a manual retry safe; it never re-submits a transaction. */
export function allow_equip_retry(character_id) {
  if (!character_id) return
  blocked_equip_character_ids = new Set(blocked_equip_character_ids)
  blocked_equip_character_ids.delete(character_id)
}

/** Positive preflight refusals spent no gas; everything else rounds toward the no-reburn latch. */
export function should_block_tx_retry(error) {
  return !is_preflight_refusal(error)
}

/**
 * Admit ONE claim flight across every surface (reveal auto-claim, boot sweep, shop chip). Refused while a
 * flight is live or once the claim succeeded this session. A LATCHED claim passes — that is the human's
 * one-click MANUAL retry (the latch only fences AUTO paths, via sweep_eligible_claims).
 * @param {string | null | undefined} claim_id @returns {boolean}
 */
export function begin_claim(claim_id) {
  if (!claim_id || claims_in_flight.has(claim_id) || claims_succeeded.has(claim_id)) return false
  claims_in_flight = new Set(claims_in_flight).add(claim_id)
  return true
}

/**
 * Settle a claim flight. No error ⇒ succeeded (never re-fired in-session). An error rounds by the burn law:
 * executed/ambiguous ⇒ latched against AUTO refire; a positively identified zero-gas refusal leaves the claim
 * sweep-eligible (the durable claim survives — the next AUTO trigger may try again for free).
 * @param {string | null | undefined} claim_id @param {{ error?: unknown }} [outcome]
 */
export function end_claim(claim_id, { error } = {}) {
  if (!claim_id) return
  claims_in_flight = new Set(claims_in_flight)
  claims_in_flight.delete(claim_id)
  if (!error) {
    claims_succeeded = new Set(claims_succeeded).add(claim_id)
    claims_latched = new Set(claims_latched)
    claims_latched.delete(claim_id)
    persist_claim_latches() // durable CLEAR — a collected claim never re-fences the boot sweep (P1)
    return
  }
  if (should_block_tx_retry(error)) {
    claims_latched = new Set(claims_latched).add(claim_id)
    persist_claim_latches() // durable LATCH — the boot sweep must not auto-refire this executed failure (P1)
  }
}

/** @param {string | null | undefined} claim_id @returns {boolean} */
export function is_claim_latched(claim_id) {
  return !!claim_id && claims_latched.has(claim_id)
}

/** The AUTO-fire filter: fresh `/v1` claims minus in-flight, latched, and already-succeeded — and EMPTY when the
 * executed-fail latch is not confirmed durable (P1 round 3). Without a durable latch, auto-firing could create an
 * executed-fail it cannot persist → a silent re-burn every boot; so the AUTO path admits nothing and the stranded
 * claims fall to the MANUAL shop-chip path (which never calls this). @param {Array<string>} claim_ids @returns {Array<string>} */
export function sweep_eligible_claims(claim_ids) {
  if (latch_durability !== 'durable') return []
  return (claim_ids ?? []).filter(
    (id) => id && !claims_in_flight.has(id) && !claims_latched.has(id) && !claims_succeeded.has(id)
  )
}

/** TEST-ONLY: isolate module-scoped session-latch assertions. */
export function _reset_box_retry_guard_for_test() {
  blocked_boxes = new Map()
  blocked_equip_character_ids = new Set()
  claims_in_flight = new Set()
  claims_succeeded = new Set()
  claims_latched = new Set()
  latch_durability = 'durable' // a simulated reboot re-derives durability via the next hydrate probe
}
