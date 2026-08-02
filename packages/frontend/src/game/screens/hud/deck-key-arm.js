// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure keyboard-arm decision for the DeckCluster spell bar — split out of DeckCluster.jsx SPECIFICALLY so it
// unit-tests without pulling in the component's other imports (useGameState/use_dungeon transitively load
// auth/index.ts -> @mysten/enoki's wallet registration, which touches `window` at MODULE-LOAD time and
// throws under bun:test's Node-like environment — the reason this repo has zero component-level tests).
// This file only needs fight.js's spell_card/WEAPON_ATTACK_ID, both already test-safe (fight.hover.test.js).

import { spell_card, WEAPON_ATTACK_ID } from '../../core/modules/fight.js'

/**
 * Resolve what a keydown key should arm — PURE (no dispatch, no DOM), so it's unit-testable without
 * mounting the component. Mirrors the click-socket gates exactly: the weapon (backtick/§/0) now ALSO
 * checks `weapon_affordable`, matching WeaponSocket's onPick — the regression this closes (the key path
 * used to only gate on `my_turn`, so it could arm an unaffordable weapon strike that a click would refuse).
 * Escape and the is_typing()/repeat/modifier guards stay in DeckCluster's effect (real DOM/focus concerns).
 * @param {KeyboardEvent} e
 * @param {{ my_turn: boolean, weapon_affordable: boolean, hand: string[], ap: number,
 *   seat?: { spell_levels?: Record<string, number> } | null }} state  `seat` = the caster's composed build, so
 *   the hotkey affords the rank the seat actually casts (#1077)
 * @returns {string | null} the spell_id (or WEAPON_ATTACK_ID) to arm, or null to do nothing
 */
export function resolve_key_arm(e, { my_turn, weapon_affordable, hand, ap, seat = null }) {
  if (!my_turn) return null
  if (e.key === '`' || e.key === '§' || e.code === 'Backquote' || e.key === '0') {
    return weapon_affordable ? WEAPON_ATTACK_ID : null
  }
  const n = Number(e.key)
  if (Number.isInteger(n) && n >= 1 && n <= 9) {
    const spell_id = hand[n - 1]
    return spell_id && spell_card(spell_id, seat).cost <= ap ? spell_id : null
  }
  return null
}

/**
 * Does this key press TARGET a spell/weapon socket at all — the UNION of resolve_key_arm's arm keys (the weapon
 * backtick/§/Backquote/0, or a 1-9 hand slot)? So the keydown effect can tell an ARM ATTEMPT that resolved to
 * nothing (off-turn / unaffordable / empty slot) from an unrelated key, and emit ONE honest "arm refused" line
 * (never a silent no-op — the FINDING B turn-start race would otherwise vanish here). @param {KeyboardEvent} e
 */
export function is_arm_key(e) {
  if (e.key === '`' || e.key === '§' || e.code === 'Backquote' || e.key === '0') return true
  const n = Number(e.key)
  return Number.isInteger(n) && n >= 1 && n <= 9
}

/**
 * MY-TURN gate for the spell bar — PURE so the DeckCluster arm gate is unit-testable (the component can't mount
 * under bun:test; see the file header). It is the SAME read DungeonBoard's `my_turn` uses (my active seat + the
 * fight unresolved), and it deliberately does NOT consult `fight.placement`: that raw flag LAGS the chain (it
 * stays stale-TRUE through the placement→ACTIVE flip window until the fold catches up), and the phase machine
 * already reconciles it against the chain status (fight-engine/phase.js — "placement is a DERIVED INPUT, never a
 * second source of truth the board reads directly"). Reading it here silently no-opped an arm keypress at turn
 * start (FINDING B). The bar's VISIBILITY (hide during placement) is gated on the RECONCILED phase in the
 * component, not this flag. @param {{ active_entity_id?: string|null, my_entity_id?: string|null, winner?: number } | null} fight
 */
export function deck_my_turn(fight) {
  return !!fight && fight.active_entity_id === fight.my_entity_id && fight.winner === -1
}
