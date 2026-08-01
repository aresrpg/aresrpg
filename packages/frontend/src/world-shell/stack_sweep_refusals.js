// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1802 rider — the boot sweep's cross-load refusal memo, and the ONLY effectful half of it. The sweep
// (auto_merge_stacks.js) stays a pure orchestrator; this is the storage door its edge injects.
//
// WHY IT EXISTS: the sweep's once-per-session latch is module state, so it dies with the tab. A plan the
// chain refused was therefore re-signed on EVERY app load — the wrong-kiosk abort (#1802) looped forever,
// and an EXECUTED failure re-burned gas each load. A refused plan's signature is the one fact worth
// surviving a reload, so it is the one fact stored.
//
// It is a MEMO, never a kill switch: the key is the exact plan (kiosk + target + source per merge), so any
// bag change composes a new signature and sweeps normally. Nothing here can wedge the sweep shut — a
// cleared browser store, a full quota or a private-mode throw all degrade to "not remembered", i.e. the
// pre-#1802 behaviour, never to "never sweep again".

import { game_log } from '../core/log.js'

const STORAGE_KEY = 'ares_stack_sweep_refused'

// Object ids are globally unique, so a signature can never collide across wallets — no per-address keying.
// Bounded so a player who keeps hitting distinct refusals cannot grow the entry without limit; the oldest
// signature falls out first, and a plan that ages out simply gets one more honest attempt.
const KEEP_LAST = 8

/** @returns {string[]} the remembered signatures, oldest first — an unreadable store is an empty memory. */
function read_signatures() {
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch (error) {
    // Spoken, never swallowed (L-D1). An unreadable store is a forgotten refusal — the sweep falls back to
    // its honest pre-memo behaviour (attempt once per load), so this degrades loudly but never blocks.
    game_log('stack-sweep', 'refusal memo unreadable — the next sweep attempts as if nothing was refused', error)
    return []
  }
}

/** @param {string[]} signatures */
function write_signatures(signatures) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(signatures.slice(-KEEP_LAST)))
  } catch (error) {
    // No store, no quota, no private-mode write. Spoken, never swallowed (L-D1): the memo is an
    // optimisation over an honest retry, so a failed write costs one repeated attempt, never correctness.
    game_log('stack-sweep', 'refusal memo could not be written — the same plan may be retried next load', error)
  }
}

/** The door `sweep_duplicate_stacks` takes: has this exact plan already failed, and remember that it did. */
export const stack_sweep_refusals = {
  /** @param {string} signature */
  has: (signature) => !!signature && read_signatures().includes(signature),
  /** @param {string} signature */
  remember: (signature) => {
    if (!signature) return
    const seen = read_signatures()
    if (!seen.includes(signature)) write_signatures([...seen, signature])
  },
}
