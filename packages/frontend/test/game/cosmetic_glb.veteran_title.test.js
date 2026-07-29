// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-5 / #1546 — the veteran-title aura gate over a MINTED title item. The gate used to read the item's
// identity as `item.id ?? item.item_type ?? item.type ?? item.name` — a `??` chain, so the FIRST present
// field wins and every later one is dead. A real minted item always carries `id`: a Sui object id (a hex
// address, never the template slug), so the gate could never light on the shape it exists for. The
// fixtures below are that shape — object-id `id` + the real `item_type` / Display `name` the /v1 character
// doc serves — plus the negatives that must stay dark.

import { describe, expect, it } from 'bun:test'

import { has_veteran_title } from '../../src/game/cosmetic_glb.js'

// The SHAPE `/v1/characters` serves as an equipped item's `id`: a 32-byte hex address. Composed, never a
// literal — no test needs a live object id, and the chain-id gate rightly refuses hardcoded ones.
const OBJECT_ID = `0x${'ab'.repeat(32)}`

describe('has_veteran_title — a minted title item lights the gate', () => {
  it('matches on item_type when the item also carries its Sui object id (#1546)', () => {
    expect(has_veteran_title({ title: { id: OBJECT_ID, item_type: 'title_veteran', item_category: 'title' } })).toBe(
      true
    )
  })

  it('matches on the Display name of the Mark of the Unbroken line', () => {
    expect(has_veteran_title({ title: { id: OBJECT_ID, item_type: 'title', name: 'Mark of the Unbroken' } })).toBe(true)
  })

  it('keeps lighting on the id-less read/admin shape the gate already served', () => {
    expect(has_veteran_title({ title: { item_type: 'title_veteran' } })).toBe(true)
  })

  it('stays dark for a non-veteran title, an empty slot, and a bare character', () => {
    expect(has_veteran_title({ title: { id: OBJECT_ID, item_type: 'title_fisher', name: 'Master Angler' } })).toBe(
      false
    )
    expect(has_veteran_title({ title: null })).toBe(false)
    expect(has_veteran_title(null)).toBe(false)
  })
})
