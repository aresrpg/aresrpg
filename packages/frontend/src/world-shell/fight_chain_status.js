// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN `Fight.status` — the ONE home for the on-chain lifecycle scalars (mirrors `fight.move`), i.e. the
// numbers `decode_fight()` hands back from a raw Fight object read.
//
// WHY THIS FILE EXISTS (#932): the client carries TWO status namespaces and they disagree on placement —
//   • CHAIN  (here, from fight.move)          — PLACEMENT 0 · ACTIVE 1 · VICTORY 2 · DEFEAT 3
//   • VIEW   (@aresrpg/fight/board_state)     — ACTIVE 1 · PLACEMENT 5 (a projected, run-aware lifecycle)
// ACTIVE is 1 in BOTH, so a module that mixes them looks correct on every active fight and silently
// mis-branches every placement one. That is exactly how a boot resume dropped players out of a live
// placement fight. Anything reading `decode_fight(...).status` imports from HERE; anything reading an
// ADAPTED board view uses the board_state constants — never a local copy of either.

export const CHAIN_STATUS_PLACEMENT = 0 // board shown, players pick cells + READY
export const CHAIN_STATUS_ACTIVE = 1 // turns running
export const CHAIN_STATUS_VICTORY = 2 // a winning side exists — claims open
export const CHAIN_STATUS_DEFEAT = 3 // no winning side — no loot/xp

/** The two HOSTABLE statuses: a fight a live session can still be sitting in. */
export const LIVE_CHAIN_STATUSES = new Set([CHAIN_STATUS_PLACEMENT, CHAIN_STATUS_ACTIVE])

/** Human label for a chain status scalar — diagnostics only (never player-facing copy). */
export function chain_status_label(status) {
  switch (Number(status)) {
    case CHAIN_STATUS_PLACEMENT:
      return 'placement'
    case CHAIN_STATUS_ACTIVE:
      return 'active'
    case CHAIN_STATUS_VICTORY:
      return 'victory'
    case CHAIN_STATUS_DEFEAT:
      return 'defeat'
    default:
      return `unknown(${status})`
  }
}
