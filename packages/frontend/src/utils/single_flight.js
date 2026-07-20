// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A latching single-flight guard for money/tx actions that must fire AT MOST ONCE per screen (e.g. the
// character-create sponsored mint — repeat clicks must never trigger a second sponsor/payment).
//
// Semantics (the exact double-submit guarantee):
//   • idle    → run(fn) invokes fn, transitions to `running` SYNCHRONOUSLY (before fn's first await) so a
//               second call in the same tick (double-click, Enter+click race, programmatic re-fire) is a no-op.
//   • running → run() is a no-op (fn is in flight).
//   • fn SUCCEEDS → state LATCHES to `done` — run() is a permanent no-op afterward (the caller closes the
//                   screen; a repeat click can never fire a second tx). This is the bug the naive `finally`
//                   re-enable reintroduces.
//   • fn FAILS (throws) → state re-arms to `idle` (no tx happened) so the user can retry; run() rethrows.
//
// `busy` is true while running OR latched — the UI reads it to keep the button disabled and to block
// cancel/keyboard during/after a successful create.
export function latching_single_flight() {
  let state = 'idle' // 'idle' | 'running' | 'done'
  return {
    get busy() {
      return state !== 'idle'
    },
    /** @param {() => Promise<void>} fn */
    async run(fn) {
      if (state !== 'idle') return // running or latched → ignore (no double-fire)
      state = 'running'
      try {
        await fn()
        state = 'done' // LATCH on success — never runs again
      } catch (error) {
        state = 'idle' // re-arm on failure so the user can retry
        throw error
      }
    },
  }
}
