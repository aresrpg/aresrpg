// orphan_item.test.ts — the ONE "this item's template was deleted on-chain" gate,
// read by the inventory grid/tooltip, the crush action and the equip/use guard. Pure + DOM-less (the
// forge_eligibility split pattern). The load-vs-delete distinction is the whole safety argument, so it is the
// bulk of the cases: an empty / still-loading map must NEVER flag a live item.
import { describe, test, expect } from 'bun:test'

import { is_template_removed } from './orphan_item'

const map = (...slugs: string[]) => new Map(slugs.map((s) => [s, { id: `0x${s}`, item_type: s }]))

describe('is_template_removed — burned-template detection', () => {
  test('populated map missing the slug → removed (the template was burned)', () => {
    expect(is_template_removed({ item_type: 'ghost_blade' }, map('iron_sword', 'oak_wand'))).toBe(true)
  })

  test('populated map that HAS the slug → not removed', () => {
    expect(is_template_removed({ item_type: 'iron_sword' }, map('iron_sword', 'oak_wand'))).toBe(false)
  })

  test('EMPTY map (still loading / read failed) → never removed, even for an unknown slug', () => {
    expect(is_template_removed({ item_type: 'iron_sword' }, new Map())).toBe(false)
    expect(is_template_removed({ item_type: 'anything' }, new Map())).toBe(false)
  })

  test('null / undefined map → not removed (defensive; map arrives async)', () => {
    expect(is_template_removed({ item_type: 'iron_sword' }, null)).toBe(false)
    expect(is_template_removed({ item_type: 'iron_sword' }, undefined)).toBe(false)
  })

  test('item without an item_type slug → not removed (nothing to join on)', () => {
    expect(is_template_removed({}, map('iron_sword'))).toBe(false)
    expect(is_template_removed(null, map('iron_sword'))).toBe(false)
    expect(is_template_removed(undefined, map('iron_sword'))).toBe(false)
  })
})
