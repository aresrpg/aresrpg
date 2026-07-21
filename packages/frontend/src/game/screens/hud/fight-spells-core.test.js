// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #106 regression: the migration seam shipped the client WITHOUT the authored spell corpus, so the old
// build-time glob resolved to nothing and build_fight_spells threw `authored spell corpus is empty` at module
// load — crashing the game chunk (the second instance of the #94 content-stub class). The corpus is now a
// RUNTIME blob (spell_corpus.js); this pure projection must be TOTAL — an empty/absent corpus yields [], never
// a throw — so the scene renders with inert spell surfaces instead of a white screen.
import { describe, expect, spyOn, test } from 'bun:test'

import { build_fight_spells } from './fight-spells-core.js'

const row = (over = {}) => ({ id: 's1', classType: 'senshi', unlock: 1, name: 'Warcleave', levels: [], ...over })

describe('build_fight_spells — total & pure over the runtime corpus (issue #106)', () => {
  test('empty corpus → { spells: [] }, never throws, no console.error (pure — the shout lives at the loader)', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    let result
    expect(() => {
      result = build_fight_spells([])
    }).not.toThrow()
    expect(result.spells).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('non-array corpus (undefined) → { spells: [] }, never throws', () => {
    expect(() => build_fight_spells(undefined)).not.toThrow()
    expect(build_fight_spells(undefined).spells).toEqual([])
  })

  test('a merged row carrying object_id → projected 1:1 (the act_cast target rides through)', () => {
    const result = build_fight_spells([row({ object_id: '0xabc' })])
    expect(result.spells).toHaveLength(1)
    expect(result.spells[0]).toMatchObject({ object_id: '0xabc', class: 'senshi', name: 'Warcleave', name_key: 'warcleave' })
  })

  test('a row with NO object_id (published before its deployment receipt) → object_id null, display facts kept', () => {
    const result = build_fight_spells([row()])
    expect(result.spells[0].object_id).toBe(null) // display-only, not castable
    expect(result.spells[0].name).toBe('Warcleave') // encyclopedia/display still works
  })

  test('sorts by class then unlock level', () => {
    const rows = [
      row({ id: 'a', classType: 'yajin', unlock: 3, name: 'Zed' }),
      row({ id: 'b', classType: 'senshi', unlock: 2, name: 'Bar' }),
      row({ id: 'c', classType: 'senshi', unlock: 1, name: 'Foo' }),
    ]
    expect(build_fight_spells(rows).spells.map((s) => s.name_key)).toEqual(['foo', 'bar', 'zed'])
  })
})
