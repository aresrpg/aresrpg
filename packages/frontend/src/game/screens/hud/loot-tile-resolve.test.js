// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight victory-card loot-tile CONTRACT (a loot slot must never render as an empty
// un-hoverable box, no matter how broken the drop's metadata is). Pure-logic tests — no DOM, no Tooltip
// portal — proving the enrichment decision + the fallback name chain + the tooltip's honest disclaimer.
import { describe, expect, test } from 'bun:test'

import { resolve_loot_tile } from './loot-tile-resolve.js'

const t = (key) => key // stub — returns the i18n key itself, deterministic for assertions

describe('resolve_loot_tile — the enrichment signal', () => {
  // #1993 WP4 — the bag is NO LONGER a resolution source (it was #1867's second home: `load_roster()` repaints
  // it after the card is on screen). A drop the catalog does not know is now honestly unresolved and renders
  // the D53 letter tile, which is what the un-hoverable-box contract has always asked for; what it must never
  // do is render one way and then another way a second later.
  test('a drop the catalog does not know is unresolved — a live bag row cannot resolve it', () => {
    const entry = { item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }
    const out = resolve_loot_tile(entry, new Map(), undefined, t)
    expect(out.resolved).toBe(false)
    expect(out.name).toBe('Rusty Blade') // the certified receipt name still stands — never discarded
    expect(out.item_id).toBeNull()
  })

  test('a template-map match alone resolves it, even with an empty bag', () => {
    const entry = { item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }
    const template_map = new Map([['rusty_blade', { name: 'Rusty Blade', category: 'sword', level: 4 }]])
    const out = resolve_loot_tile(entry, template_map, undefined, t)
    expect(out.resolved).toBe(true)
  })

  test('neither a bag match NOR a template row → unresolved (the orphaned-drop case)', () => {
    const entry = { item_type: 'qa_ghost_blade_01', name: 'QA Ghost Blade', amount: 1 }
    const out = resolve_loot_tile(entry, new Map(), undefined, t)
    expect(out.resolved).toBe(false)
    expect(out.name).toBe('QA Ghost Blade') // the entry's own name still wins — never discarded
  })
})

describe("resolve_loot_tile — the fallback name chain (template name → entry name → item_type words → '?')", () => {
  test('entry.name present, unresolved → the entry name is used verbatim', () => {
    const out = resolve_loot_tile({ item_type: 'qa_thing', name: 'QA Thing', amount: 1 }, new Map(), undefined, t)
    expect(out.name).toBe('QA Thing')
  })

  test('entry.name MISSING, unresolved → the item_type slug humanized to words', () => {
    const out = resolve_loot_tile(
      { item_type: 'qa_ghost_blade_01', name: undefined, amount: 1 },
      new Map(),
      undefined,
      t
    )
    expect(out.name).toBe('qa ghost blade 01')
  })

  test("nothing at all rode the wire (no name, no item_type) → the literal '?' last resort", () => {
    const out = resolve_loot_tile({ item_type: undefined, name: undefined, amount: 1 }, new Map(), undefined, t)
    expect(out.name).toBe('?')
  })
})

describe('resolve_loot_tile — the tooltip never lies about what it knows', () => {
  test('unresolved but a name exists → NO false "metadata unavailable" disclaimer', () => {
    const out = resolve_loot_tile({ item_type: 'qa_thing', name: 'QA Thing', amount: 1 }, new Map(), undefined, t)
    expect(out.detail.description).toBeUndefined()
  })

  test('unresolved AND no name at all → the honest i18n disclaimer rides the tooltip description', () => {
    const out = resolve_loot_tile(
      { item_type: 'qa_ghost_blade_01', name: undefined, amount: 1 },
      new Map(),
      undefined,
      t
    )
    expect(out.detail.description).toBe('fight_end.loot_metadata_unavailable')
  })

  test('resolved via a real template → the template Display description wins (unaffected by the new branch)', () => {
    const template_map = new Map([
      ['rusty_blade', { name: 'Rusty Blade', category: 'sword', level: 4, display: { description: 'A worn blade.' } }],
    ])
    const out = resolve_loot_tile(
      { item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 },
      template_map,
      undefined,
      t
    )
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
    const out = resolve_loot_tile(entry, template_map, undefined, t)

    expect(out.icon).toBe('obsidian_core')
    expect(out.icon).not.toBe('resource')
  })

  // #437: a victory-card loot tile is a FRESHLY ROLLED OWNED instance (the drop the player just got),
  // never a template preview — the same contract as the inventory hover (Inventory.jsx) and the same
  // onchain_template_to_detail_props seam. A genuine template RANGE describes what the drop COULD have
  // rolled, not what it did, so it must never render on this surface.
  test('a genuine template range is suppressed on the victory tile — a fresh drop is an owned instance (#437)', () => {
    const out = resolve_loot_tile(entry, template_map, undefined, t)

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
    const out = resolve_loot_tile(entry, fixed_template_map, undefined, t)

    expect(out.detail.stats).toEqual({})
  })

  test('the receipt item id IS the owned instance — no bag lookup can move it', () => {
    const out = resolve_loot_tile(
      { ...entry, item_id: '0xreceipt-created' },
      template_map,
      undefined,
      t,
      {},
      { vitality: 32775 }
    )

    expect(out.item_id).toBe('0xreceipt-created')
    expect(out.detail.stats).toEqual({ vitality: [7, 7] })
    expect(out.detail.stats).not.toEqual({ vitality: [4, 9], wisdom: [1, 3] })
  })

  test('an aggregate receipt row without a concrete item id never guesses a sibling roll', () => {
    const out = resolve_loot_tile(entry, template_map, undefined, t)

    expect(out.item_id).toBeNull()
  })

  test('a RESOURCE with no snapshot slug still resolves its itemType (render layer glyphs on 404)', () => {
    // chain_icon_slug is the itemType itself, so a missing catalog mapping costs nothing; ItemImage's
    // 404 fallback owns the unpublished-art glyph (obsidian_core.png is genuinely not uploaded yet).
    const out = resolve_loot_tile({ ...entry, icon_slug: undefined }, template_map, undefined, t)
    expect(out.icon).toBe('obsidian_core')
    // the CATALOG's spelling now, not a bag row's: `category_glyph` looks up exact-then-lowercased, so the
    // renderer reads one fact either way — which is the point of having only one source left (#1993 WP4).
    expect(out.category).toBe('RESOURCE')
  })
})

describe('resolve_loot_tile — republish-stable live catalog join (#1522)', () => {
  test('the injected live template-id map wins over a generic chain class', () => {
    const template_id = `0x${'1522'.repeat(16)}`
    const out = resolve_loot_tile(
      {
        template_id,
        item_type: 'resource',
        name: 'Starfell Shard',
        amount: 1,
      },
      new Map([[template_id, { name: 'Starfell Shard', item_type: 'resource', category: 'RESOURCE' }]]),
      undefined,
      t,
      { [template_id]: 'post_republish_starfell_shard' }
    )

    expect(out.resolved).toBe(true)
    expect(out.icon).toBe('post_republish_starfell_shard')
  })

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
      live_templates,
      undefined,
      t
    )

    expect(out.resolved).toBe(true)
    expect(out.icon).toBe('post_republish_starfell_shard')
  })
})

// ── ICON-KEY CONTRACTS (moved here from FightReport.test.jsx with #1993 WP4: they used to be asserted through a
//    static card render whose only path to `resolved` was a live bag row — the second source that work package
//    deleted. The decision has always lived in this resolver; now the test does too.)
describe('resolve_loot_tile — the icon key routes through the shared inventory resolver', () => {
  test('a published RESOURCE resolves its exact manifest art, never the generic resource package', () => {
    const template_id = `0x${'e13d'.repeat(16)}` // synthetic runtime id — a source literal trips the chain-id gate
    // Chain-truth shape (live /v1): `item_type` is the authored art slug; 'resource' is the CATEGORY.
    const catalog = new Map([[template_id, { id: template_id, item_type: 'obsidian_core', category: 'RESOURCE', name: 'Obsidian Core' }]])
    const out = resolve_loot_tile({ template_id, item_type: 'obsidian_core', name: 'Obsidian Core', amount: 2 }, catalog, undefined, t)

    expect(out.resolved).toBe(true)
    expect(out.icon).toBe('obsidian_core')
    expect(out.icon).not.toBe('resource')
  })

  test("a cosmetic drop resolves via inventory_item_icon's alias, not the raw on-chain slot word", () => {
    const catalog = new Map([['hat', { item_type: 'hat', category: 'cosmetic_helmet', name: 'Fuwa Hood (White)' }]])
    const out = resolve_loot_tile({ item_type: 'hat', name: 'Fuwa Hood (White)', amount: 3 }, catalog, undefined, t)

    // the shared resolver's alias (proven live: HTTP 200)
    expect(out.icon).toBe('coiffe_fuwa-white')
    // the raw item_type bypass the original bug shipped (proven live: HTTP 404 — the placeholder-box trigger)
    expect(out.icon).not.toBe('hat')
  })

  test('an ordinary (non-cosmetic) drop is UNCHANGED — item_type still wins when no alias/slug exists', () => {
    const catalog = new Map([['rusty_blade', { item_type: 'rusty_blade', category: 'sword', name: 'Rusty Blade' }]])
    const out = resolve_loot_tile({ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }, catalog, undefined, t)

    expect(out.icon).toBe('rusty_blade')
  })
})
