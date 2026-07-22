// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight victory-card loot-tile CONTRACT (a loot slot must never render as an empty
// un-hoverable box, no matter how broken the drop's metadata is). Pure-logic tests — no DOM, no Tooltip
// portal — proving the enrichment decision + the fallback name chain + the tooltip's honest disclaimer.
import { describe, expect, test } from 'bun:test'

import { resolve_loot_tile } from './loot-tile-resolve.js'

const t = (key) => key // stub — returns the i18n key itself, deterministic for assertions

describe('resolve_loot_tile — the enrichment signal', () => {
  test('a bag match (items[]) alone resolves it, even with an empty template map', () => {
    const entry = { item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }
    const items = [{ item_type: 'rusty_blade', name: 'Rusty Blade', category: 'sword', quality: 'common' }]
    const out = resolve_loot_tile(entry, items, new Map(), undefined, t)
    expect(out.resolved).toBe(true)
    expect(out.name).toBe('Rusty Blade')
  })

  test('a template-map match alone resolves it, even with an empty bag', () => {
    const entry = { item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }
    const template_map = new Map([['rusty_blade', { name: 'Rusty Blade', category: 'sword', level: 4 }]])
    const out = resolve_loot_tile(entry, [], template_map, undefined, t)
    expect(out.resolved).toBe(true)
  })

  test('neither a bag match NOR a template row → unresolved (the orphaned-drop case)', () => {
    const entry = { item_type: 'qa_ghost_blade_01', name: 'QA Ghost Blade', amount: 1 }
    const out = resolve_loot_tile(entry, [], new Map(), undefined, t)
    expect(out.resolved).toBe(false)
    expect(out.name).toBe('QA Ghost Blade') // the entry's own name still wins — never discarded
  })
})

describe('resolve_loot_tile — the fallback name chain (template name → entry name → item_type words → \'?\')', () => {
  test('entry.name present, unresolved → the entry name is used verbatim', () => {
    const out = resolve_loot_tile({ item_type: 'qa_thing', name: 'QA Thing', amount: 1 }, [], new Map(), undefined, t)
    expect(out.name).toBe('QA Thing')
  })

  test('entry.name MISSING, unresolved → the item_type slug humanized to words', () => {
    const out = resolve_loot_tile({ item_type: 'qa_ghost_blade_01', name: undefined, amount: 1 }, [], new Map(), undefined, t)
    expect(out.name).toBe('qa ghost blade 01')
  })

  test('nothing at all rode the wire (no name, no item_type) → the literal \'?\' last resort', () => {
    const out = resolve_loot_tile({ item_type: undefined, name: undefined, amount: 1 }, [], new Map(), undefined, t)
    expect(out.name).toBe('?')
  })
})

describe('resolve_loot_tile — the tooltip never lies about what it knows', () => {
  test('unresolved but a name exists → NO false "metadata unavailable" disclaimer', () => {
    const out = resolve_loot_tile({ item_type: 'qa_thing', name: 'QA Thing', amount: 1 }, [], new Map(), undefined, t)
    expect(out.detail.description).toBeUndefined()
  })

  test('unresolved AND no name at all → the honest i18n disclaimer rides the tooltip description', () => {
    const out = resolve_loot_tile({ item_type: 'qa_ghost_blade_01', name: undefined, amount: 1 }, [], new Map(), undefined, t)
    expect(out.detail.description).toBe('fight_end.loot_metadata_unavailable')
  })

  test('resolved via a real template → the template Display description wins (unaffected by the new branch)', () => {
    const template_map = new Map([
      ['rusty_blade', { name: 'Rusty Blade', category: 'sword', level: 4, display: { description: 'A worn blade.' } }],
    ])
    const out = resolve_loot_tile({ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }, [], template_map, undefined, t)
    expect(out.detail.description).toBe('A worn blade.')
  })
})

describe('resolve_loot_tile — exact RESOURCE art + template characteristics', () => {
  // synthetic 32-byte id built at runtime — the resolver only needs id identity, and a source
  // literal would trip the hardcoded chain-id gate.
  const template_id = `0x${'e13d'.repeat(16)}`
  const entry = { template_id, item_type: 'resource', name: 'Obsidian Core', amount: 2 }
  const items = [
    {
      id: '0xitem',
      template_id,
      item_type: 'resource',
      item_category: 'resource',
      name: 'Obsidian Core',
    },
  ]
  const template_map = new Map([
    [
      template_id,
      {
        id: template_id,
        item_type: 'resource',
        category: 'RESOURCE',
        name: 'Obsidian Core',
        statsJson: JSON.stringify({ vitality: [4, 9], wisdom: [1, 3] }),
      },
    ],
  ])

  test('a published RESOURCE uses its exact render slug, never the generic resource box', () => {
    const out = resolve_loot_tile(entry, items, template_map, undefined, t, {
      [template_id]: 'obsidian_core',
    })

    expect(out.icon).toBe('obsidian_core')
    expect(out.icon).not.toBe('resource')
  })

  // #437: a victory-card loot tile is a FRESHLY ROLLED OWNED instance (the drop the player just got),
  // never a template preview — the same contract as the inventory hover (Inventory.jsx) and the same
  // onchain_template_to_detail_props seam. A genuine template RANGE describes what the drop COULD have
  // rolled, not what it did, so it must never render on this surface.
  test('a genuine template range is suppressed on the victory tile — a fresh drop is an owned instance (#437)', () => {
    const out = resolve_loot_tile(entry, items, template_map, undefined, t, {
      [template_id]: 'obsidian_core',
    })

    expect(out.detail.stats).toEqual({})
  })

  test('a degenerate (fixed) template value still renders — it IS the drop\'s real stat', () => {
    const fixed_template_map = new Map([
      [
        template_id,
        {
          id: template_id,
          item_type: 'resource',
          category: 'RESOURCE',
          name: 'Obsidian Core',
          statsJson: JSON.stringify({ vitality: [4, 4] }),
        },
      ],
    ])
    const out = resolve_loot_tile(entry, items, fixed_template_map, undefined, t, {
      [template_id]: 'obsidian_core',
    })

    expect(out.detail.stats).toEqual({ vitality: [4, 4] })
  })

  test('an unmapped RESOURCE still resolves the name-derived slug (render layer glyphs on 404)', () => {
    // Contract updated by the chain_icon_slug home (#160): resolve returns the slugified chain
    // name even without a catalog mapping; ItemImage's 404 fallback owns the unpublished-art glyph.
    const out = resolve_loot_tile(entry, items, template_map, undefined, t, {})
    expect(out.icon).toBe('obsidian_core')
    expect(out.category).toBe('resource')
  })
})
