// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (the end-fight card's party row showed "0xDEE0…AD38" — a raw address slice baked by
// packages/fight/src/project.js:321 whenever the live mid-fight roster resolve hadn't landed by fight-end).
// Proves the card's OWN re-resolution never lets that slice — or any other pre-existing garbage name — survive
// on a non-local player row, while leaving mobs and the local player's row untouched.
import { describe, expect, it } from 'bun:test'

import { resolvable_row_ids, apply_resolved_names } from './fight_report_names.js'

describe('resolvable_row_ids — who needs a /v1 character-doc lookup', () => {
  it('collects non-local PLAYER rows only', () => {
    const rows = [
      { id: '0xme', is_player: true, is_me: true },
      { id: '0xally', is_player: true, is_me: false },
      { id: 'mob-0', is_player: false, is_me: false },
    ]
    expect(resolvable_row_ids(rows)).toEqual(['0xally'])
  })

  it('dedupes repeated ids and drops falsy ids', () => {
    const rows = [
      { id: '0xally', is_player: true },
      { id: '0xally', is_player: true },
      { id: null, is_player: true },
      { id: undefined, is_player: true },
    ]
    expect(resolvable_row_ids(rows)).toEqual(['0xally'])
  })

  it('empty/undefined rows yield no work', () => {
    expect(resolvable_row_ids([])).toEqual([])
    expect(resolvable_row_ids(undefined)).toEqual([])
  })
})

describe('apply_resolved_names — the raw-address-slice repro ("0xDEE0…AD38" on a party row)', () => {
  it('a non-local party row carrying the upstream address slice is REPLACED by the resolved character name', () => {
    const rows = [
      {
        id: '0xdee0fa5d_ally_character_fixture_id', // long+fake on purpose — never a real 64-hex chain id
        // the exact shape packages/fight/src/project.js:321 bakes: `${addr.slice(0,6)}…${addr.slice(-4)}`
        name: '0xDEE0…AD38',
        is_player: true,
        is_me: false,
      },
    ]
    const docs = new Map([[rows[0].id, { name: 'Ally' }]])
    const out = apply_resolved_names(rows, docs)
    expect(out[0].name).toBe('Ally')
    expect(out[0].name).not.toContain('0xDEE0')
  })

  it('no resolved doc yet → the ONE short_fighter_id fallback, never the raw/poisoned name it arrived with', () => {
    const long_id = '0xdee0fa5d_ally_character_fixture_id' // long+fake — never a real 64-hex chain id
    const rows = [{ id: long_id, name: '0xDEE0…AD38', is_player: true, is_me: false }]
    const out = apply_resolved_names(rows, new Map())
    expect(out[0].name).toBe(`${long_id.slice(0, 7)}…${long_id.slice(-5)}`) // short_fighter_id's exact shape
    expect(out[0].name).not.toBe('0xDEE0…AD38') // the old 6+4 slice never survives
  })

  it('a mob/content row is NEVER touched — its name is real game content, not a chain identity', () => {
    const rows = [{ id: 'mob-0', name: 'Razkin', is_player: false, is_me: false }]
    expect(apply_resolved_names(rows, new Map())).toEqual(rows)
  })

  it("the local player's own row is NEVER touched — already correct + synchronous, no round trip", () => {
    const rows = [{ id: '0xme', name: 'Hero', is_player: true, is_me: true }]
    expect(apply_resolved_names(rows, new Map())).toEqual(rows)
  })

  it('a resolved doc with no name still falls to short_fighter_id (never an empty/undefined name)', () => {
    const rows = [{ id: '0xally', name: 'stale', is_player: true, is_me: false }]
    const out = apply_resolved_names(rows, new Map([['0xally', {}]]))
    expect(out[0].name).toBe('0xally') // short_fighter_id: length <= 14 → returned as-is
  })
})
