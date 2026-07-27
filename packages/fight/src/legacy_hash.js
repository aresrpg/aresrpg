// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Compatibility hash retained for older diagnostics. New divergence reporting uses fingerprint.js, whose image is
// viewer-free and includes the chain turn ordinal plus statuses.

export const canonical_state = (state) => ({
  fight_id: state.fight_id,
  phase: state.phase,
  active: state.active,
  turn_deadline_ms: state.turn_deadline_ms,
  winner: state.winner,
  fighters: Object.keys(state.fighters)
    .sort()
    .map((key) => {
      const fighter = state.fighters[key]
      return {
        key,
        cell: fighter.cell,
        hp: fighter.hp,
        alive: fighter.alive,
        invisible: fighter.invisible,
        ap: fighter.ap ?? null,
        mp: fighter.mp ?? null,
        ready: fighter.ready ?? null,
      }
    }),
  wave: (state.wave ?? []).map((turn) => ({
    seq: turn.seq,
    version: turn.version,
    source_id: turn.source_id ?? null,
    is_local: !!turn.is_local,
  })),
  presented_seq: state.presented_seq ?? 0,
  settlement: state.settlement?.chain_terminal?.signal ?? null,
})

export const state_hash = (state) => {
  const text = JSON.stringify(canonical_state(state))
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
