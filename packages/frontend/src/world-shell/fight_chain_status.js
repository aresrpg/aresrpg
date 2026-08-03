// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN `Fight.status` — the ONE home for the on-chain lifecycle scalars this shell branches on, i.e. the
// numbers `decode_fight()` hands back from a raw Fight object read. The SDK already owns their LABELS
// (`fight_status_label`, fight_read.js, mirroring fight.move) — import that for diagnostics; never re-spell it.
//
// WHY THIS FILE EXISTS (#932): the client carries TWO status namespaces and they disagree on placement —
//   • CHAIN  (here, from fight.move)          — PLACEMENT 0 · ACTIVE 1 · VICTORY 2 · DEFEAT 3
//   • VIEW   (@aresrpg/fight/board_state)     — ACTIVE 1 · PLACEMENT 5 (a projected, run-aware lifecycle)
// ACTIVE is 1 in BOTH, so a module that mixes them looks correct on every active fight and mis-branches every
// placement one. That is exactly how a boot resume threw players out of a live placement fight. Anything
// reading `decode_fight(...).status` imports from HERE; anything reading an ADAPTED board view imports the
// board_state constants — never a local copy of either.

export const CHAIN_STATUS_PLACEMENT = 0 // board shown, players pick cells + READY
export const CHAIN_STATUS_ACTIVE = 1 // turns running

/** The two HOSTABLE statuses: a fight a live session can still be sitting in (everything else is terminal). */
export const LIVE_CHAIN_STATUSES = new Set([CHAIN_STATUS_PLACEMENT, CHAIN_STATUS_ACTIVE])

/**
 * PURE — is THIS character's seat in a chain-decoded Fight already a corpse? (#2136 / #2139.) `hp` rides the raw
 * participant passthrough (`decode_fight` keeps `json.participants` verbatim), so it arrives as a gRPC string —
 * hence the Number() coercion. An ABSENT seat is deliberately NOT dead: a torn/incomplete participants read must
 * degrade to the status-only verdict, never fabricate a death that locks a live player out of their own fight.
 *
 * IT LIVES HERE, in the zero-dependency leaf, because BOTH readers of `decode_fight(...)` need it and neither may
 * import the other: `fight-liquidation.js` (the world boot gate, #2136) is a janitor module that composes chain
 * WRITES, and `fight_liveness.js` (the dungeon resume gate, #2139) is a pure read leaf — pointing the read at the
 * janitor to borrow one predicate would invert the layering, and spelling it twice is the dual-home bug this
 * codebase treats as its worst class. One home, imported by both.
 * @param {{ participants?: any[] } | null} decoded
 * @param {string | null | undefined} character_id
 */
export function seat_is_dead(decoded, character_id) {
  if (!decoded || !character_id) return false
  const seat = (decoded.participants ?? []).find(
    (/** @type {any} */ p) => String(p?.character ?? '') === String(character_id)
  )
  return !!seat && Number(seat.hp ?? 0) <= 0
}
