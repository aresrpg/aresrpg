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
    const items = [
      { id: '0xblade', item_type: 'rusty_blade', name: 'Rusty Blade', category: 'sword', quality: 'common' },
    ]
    const out = resolve_loot_tile(entry, items, new Map(), undefined, t)
    expect(out.resolved).toBe(true)
    expect(out.name).toBe('Rusty Blade')
    expect(out.item_id).toBeNull()
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
  // Chain-truth shape (live /v1, 2026-07-25): `item_type` is the AUTHORED art slug `obsidian_core`;
  // the generic family word 'resource' is the row's `category`. The two are never the same field.
  const entry = {
    template_id,
    item_type: 'obsidian_core',
    icon_slug: 'obsidian_core',
    name: 'Obsidian Core',
    amount: 2,
  }
  const items = [
    {
      id: '0xitem',
      template_id,
      item_type: 'obsidian_core',
      item_category: 'resource',
      name: 'Obsidian Core',
    },
  ]
  const template_map = new Map([
    [
      template_id,
      {
        id: template_id,
        item_type: 'obsidian_core',
        category: 'RESOURCE',
        name: 'Obsidian Core',
        statsJson: JSON.stringify({ vitality: [4, 9], wisdom: [1, 3] }),
      },
    ],
  ])

  test('a live-snapshotted RESOURCE uses its exact render slug, never the generic resource box', () => {
    const out = resolve_loot_tile(entry, items, template_map, undefined, t)

    expect(out.icon).toBe('obsidian_core')
    expect(out.icon).not.toBe('resource')
  })

  // #437: a victory-card loot tile is a FRESHLY ROLLED OWNED instance (the drop the player just got),
  // never a template preview — the same contract as the inventory hover (Inventory.jsx) and the same
  // onchain_template_to_detail_props seam. A genuine template RANGE describes what the drop COULD have
  // rolled, not what it did, so it must never render on this surface.
  test('a genuine template range is suppressed on the victory tile — a fresh drop is an owned instance (#437)', () => {
    const out = resolve_loot_tile(entry, items, template_map, undefined, t)

    expect(out.detail.stats).toEqual({})
  })

  test('a template value never substitutes for an unresolved owned roll, even when degenerate', () => {
    const fixed_template_map = new Map([
      [
        template_id,
        {
          id: template_id,
          item_type: 'obsidian_core',
          category: 'RESOURCE',
          name: 'Obsidian Core',
          statsJson: JSON.stringify({ vitality: [4, 4] }),
        },
      ],
    ])
    const out = resolve_loot_tile(entry, items, fixed_template_map, undefined, t)

    expect(out.detail.stats).toEqual({})
  })

  test('the receipt item id selects the exact owned instance regardless of bag order', () => {
    const duplicate_items = [
      { ...items[0], id: '0xreceipt-created' },
      { ...items[0], id: '0xolder' },
    ]
    const out = resolve_loot_tile(
      { ...entry, item_id: '0xreceipt-created' },
      duplicate_items,
      template_map,
      undefined,
      t,
      { vitality: 32775 },
    )

    expect(out.item_id).toBe('0xreceipt-created')
    expect(out.detail.stats).toEqual({ vitality: [7, 7] })
    expect(out.detail.stats).not.toEqual({ vitality: [4, 9], wisdom: [1, 3] })
  })

  test('an aggregate receipt row without a concrete item id never guesses a sibling roll', () => {
    const out = resolve_loot_tile(entry, items, template_map, undefined, t)

    expect(out.item_id).toBeNull()
  })

  test('a RESOURCE with no snapshot slug still resolves its itemType (render layer glyphs on 404)', () => {
    // chain_icon_slug is the itemType itself, so a missing catalog mapping costs nothing; ItemImage's
    // 404 fallback owns the unpublished-art glyph (obsidian_core.png is genuinely not uploaded yet).
    const out = resolve_loot_tile({ ...entry, icon_slug: undefined }, items, template_map, undefined, t)
    expect(out.icon).toBe('obsidian_core')
    expect(out.category).toBe('resource')
  })
})

describe('resolve_loot_tile — republish-stable live catalog join (#1522)', () => {
  test('a shuffled receipt re-mint resolves the loot icon by its stable name, never the stale template id', () => {
    const receipt_template_id = `0x${'1522'.repeat(16)}`
    const live_template_id = `0x${'2251'.repeat(16)}`
    const unrelated_id = `0x${'1018'.repeat(16)}`
    const live_templates = new Map([
      [unrelated_id, { id: unrelated_id, item_type: 'moonstone_chip', name: 'Moonstone Chip', category: 'RESOURCE' }],
      [
        live_template_id,
        {
          id: live_template_id,
          item_type: 'post_republish_starfell_shard',
          name: 'Starfell Shard',
          category: 'RESOURCE',
        },
      ],
    ])

    const out = resolve_loot_tile(
      {
        template_id: receipt_template_id,
        item_type: 'resource',
        name: 'Starfell Shard',
        amount: 1,
      },
      [],
      live_templates,
      undefined,
      t,
    )

    expect(out.resolved).toBe(true)
    expect(out.icon).toBe('post_republish_starfell_shard')
  })
})
