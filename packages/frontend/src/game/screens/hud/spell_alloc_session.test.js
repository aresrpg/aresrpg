// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (Leg A — a spell can level but every indication stays lvl 1, available points stay 1,
// while the toast confirmed). A store-level proof of the receipt floor: a success receipt must raise the spell +
// decrement the available point, and a STALE chain-direct read (the fullnode lagging the just-committed tx) must
// never regress the receipt-proven fact. Mirrors Stats.test.jsx's confirmed-projection proofs.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  apply_upgrade_receipt,
  clear_confirmed_spell,
  merge_confirmed,
  record_confirmed_spell,
  spell_alloc_caught_up,
  spell_session_snapshot,
} from './spell_alloc_session.js'

const SPELL = '0xgutterknife'
const CHAR = '0xchar'

// The unspent-points derivation the panel renders (spellbook-data.js): (character level − 1) − spent, floored 0.
const points = (/** @type {number} */ char_level, /** @type {any} */ alloc) =>
  Math.max(0, char_level - 1 - Number(alloc?.spent ?? 0))

afterEach(() => clear_confirmed_spell(CHAR, spell_session_snapshot().confirmed[CHAR]))

describe('spell allocation receipt floor', () => {
  test('a success receipt raises the spell + decrements points, and a STALE chain read never regresses it', () => {
    // Character level 2; one class spell at the free baseline 1; nothing spent yet → 1 unspent spell point.
    const chain0 = { spent: 0, levels: { [SPELL]: 1 } }
    expect(chain0.levels[SPELL]).toBe(1)
    expect(points(2, chain0)).toBe(1)

    // PREDICT ON RECEIPT: raise_spell_level(SPELL) succeeded; the S8 cost for 1→2 is 1. Proven projection:
    const confirmed = apply_upgrade_receipt(null, chain0, SPELL, 1)
    const after = merge_confirmed(chain0, confirmed)
    expect(after.levels[SPELL]).toBe(2) // the spell level moved 1 → 2
    expect(points(2, after)).toBe(0) // the available point was spent 1 → 0

    // RECONCILE — a STALE chain-direct read lands (the fullnode hasn't indexed the just-committed tx yet): it
    // still reports the PRE-upgrade allocation. The receipt-proven fact is a FLOOR — it must NOT regress below it.
    const stale = { spent: 0, levels: { [SPELL]: 1 } }
    const reconciled = merge_confirmed(stale, confirmed)
    expect(reconciled.levels[SPELL]).toBe(2) // today's bug: blind adopt regressed this back to 1
    expect(points(2, reconciled)).toBe(0) // ...and the point count back to 1
    expect(spell_alloc_caught_up(stale, confirmed)).toBe(false) // the projection stays held

    // The caught-up chain read (the fullnode indexed the tx) reaches the floor → the projection may drop.
    const fresh = { spent: 1, levels: { [SPELL]: 2 } }
    expect(spell_alloc_caught_up(fresh, confirmed)).toBe(true)
    expect(merge_confirmed(fresh, confirmed)).toEqual(fresh)
  })

  test('two upgrades before the chain catches up compose (spent + per-spell level both accumulate)', () => {
    const chain0 = { spent: 0, levels: { [SPELL]: 1 } }
    const one = apply_upgrade_receipt(null, chain0, SPELL, 1) // 1 → 2, cost 1
    const two = apply_upgrade_receipt(one, chain0, SPELL, 2) // 2 → 3, cost 2 (target 3 − 1)
    expect(two).toEqual({ spent: 3, levels: { [SPELL]: 3 } })
    // a stale read still shows level 1 / spent 0 — the composed projection floors both up.
    expect(merge_confirmed({ spent: 0, levels: { [SPELL]: 1 } }, two)).toEqual({ spent: 3, levels: { [SPELL]: 3 } })
  })

  test('the module-level session survives Spellbook remounts (record → snapshot → clear)', () => {
    const confirmed = apply_upgrade_receipt(null, { spent: 0, levels: { [SPELL]: 1 } }, SPELL, 1)
    record_confirmed_spell(CHAR, confirmed)
    expect(spell_session_snapshot().confirmed[CHAR]).toBe(confirmed)
    clear_confirmed_spell(CHAR, confirmed)
    expect(spell_session_snapshot().confirmed[CHAR]).toBeUndefined()
  })
})
