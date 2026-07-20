// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-function tests for the item characteristics join (item_catalog.ts) — pins a rage-bug case
// ("Koa Slime Codex" rendering another item's stat lines) and the join-key laws that fix it:
//   1. EXACT OWN STATS — a pinned item's rendered stat lines are its OWN authored ranges, nothing else's.
//   2. SLUG-ONLY JOIN, NEVER NAME/INDEX — three "Koa Slime *" items (a resource-adjacent weapon, a spellbook,
//      an armor piece) share a name PREFIX; each must resolve to its own distinct block, proving there is no
//      name-collision or index leak between rows.
//   3. RENAMED ITEMS RESOLVE BY THEIR CURRENT NAME — one of the 336 L100-200 renames (07-13) is pinned: the
//      new on-chain name must resolve its OWN current stats (the prior name/id join against the legacy
//      @aresrpg/sdk catalog had never even heard of this item, seed/mainnet was the only place it ever lived).
//   4. HONEST EMPTY — a name with no slug returns undefined, never a fabricated/neighbor value.
//
// The maps are recomputed LIVE FROM seed/mainnet here, via the SAME shared transform the build uses
// (scripts/lib/item_catalog_transform.mjs → virtual:item_catalog). There is no checked-in item_catalog.json /
// item_slugs.json anymore (seed/mainnet is the single source of truth): so this suite inherently tests SEED TRUTH — a seed edit
// that moved these values fails HERE (re-pin below), never silently in the UI, and staleness is structurally
// impossible because nothing is cached to go stale.
//
// 2026-07-14: stat-range pins re-pinned to the UPU-rescale seed truth (gear/pet rescale — intended data).
// 2026-07-15: re-pinned again to the corpus-fidelity rescale (D743 distributional pass — the fresh-universe seed).
//
// Run with: bun test packages/frontend/src/pages/encyclopedia/item_catalog.test.ts

import { describe, test, expect } from 'bun:test'

import { build_item_catalog } from '../../../../../scripts/lib/item_catalog_transform.mjs'

import { make_catalog_lookup } from './item_catalog'

// One live derivation from seed, shared by every assertion (identical to what the Vite virtual module embeds).
const { catalog, slugs } = build_item_catalog()
const catalog_for_name = make_catalog_lookup({ catalog, slugs })

describe('catalog_for_name — regression case: Koa Slime Codex', () => {
  test('resolves EXACTLY its own 3 stats + its own damage line, nothing from another item', () => {
    const tmpl = catalog_for_name('Koa Slime Codex')
    expect(tmpl).toBeDefined()
    expect(tmpl!.damages).toEqual([{ element: 'EARTH', from: 7, to: 14 }])
    // Pins the CURRENT seed truth (values move with rebalances — regen the catalog, then re-pin here).
    expect(tmpl!.stats).toEqual({
      waterResistance: [6, 10], // seed water_resistance, camelCased by map_stats (content.ts)
      intelligence: [5, 5],
      vitality: [1, 1],
    })
    // The exact wrong lines from the bug (fire dmg, agility, ap, fireResistance) must be ABSENT.
    expect(tmpl!.damages.some((d) => d.element === 'FIRE')).toBe(false)
    expect(tmpl!.stats).not.toHaveProperty('agility')
    expect(tmpl!.stats).not.toHaveProperty('ap')
    expect(tmpl!.stats).not.toHaveProperty('fireResistance')
  })
})

describe('catalog_for_name — collision guard: the "Koa Slime *" family', () => {
  // Three distinct items sharing a name prefix, from three different seed worlds/categories. A name- or
  // index-keyed join is exactly the failure mode that would blur these together; slug-only must not.
  test("Koa Slime Rod resolves its own earth 10-18 weapon line, not the Codex's", () => {
    const tmpl = catalog_for_name('Koa Slime Rod')
    expect(tmpl!.damages).toEqual([{ element: 'EARTH', from: 10, to: 18 }])
    expect(tmpl!.stats).toEqual({ airResistance: [6, 10], intelligence: [5, 5], agility: [5, 5] })
  })

  test('Koa Slime Brigandine resolves its own armor stats, no damage line at all', () => {
    const tmpl = catalog_for_name('Koa Slime Brigandine')
    expect(tmpl!.damages).toEqual([])
    expect(tmpl!.stats).toEqual({ intelligence: [5, 5], vitality: [7, 9], waterResistance: [1, 2] })
  })

  test('all three resolve to distinct catalog rows', () => {
    const codex = catalog_for_name('Koa Slime Codex')
    const rod = catalog_for_name('Koa Slime Rod')
    const brigandine = catalog_for_name('Koa Slime Brigandine')
    expect(codex!.stats).not.toEqual(rod!.stats)
    expect(codex!.stats).not.toEqual(brigandine!.stats)
    expect(rod!.stats).not.toEqual(brigandine!.stats)
  })
})

describe('catalog_for_name — a renamed item (L100-200 rename train, 07-13, 336 items)', () => {
  // packages/move/scripts/out/l100_renames_input.json: slug sundered_vambraces_of_screaming_rift,
  // old name "The Guards of the Screaming Rift" -> new name "Sundered Vambraces". This item never existed
  // in the legacy @aresrpg/sdk catalog under EITHER name (it's world 16 content, added long after that
  // catalog's 2026-06-29 legacy pull) — the old join silently showed it honest-empty; the new one must show
  // its OWN current stats.
  test('resolves by its NEW name to its own stats, not honest-empty and not a neighbor', () => {
    const tmpl = catalog_for_name('Sundered Vambraces')
    expect(tmpl).toBeDefined()
    expect(tmpl!.rarity).toBe('epic')
    expect(tmpl!.item_type).toBe('gauntlets')
    expect(tmpl).not.toHaveProperty('weapon_class')
    expect(tmpl!.stats).toEqual({
      criticalHit: [6, 10],
      vitality: [51, 100],
      wisdom: [9, 15],
      fireResistance: [3, 5],
    })
  })

  test('the OLD pre-rename name resolves nothing (the name->slug map is keyed by CURRENT live names only)', () => {
    expect(catalog_for_name('The Guards of the Screaming Rift')).toBeUndefined()
  })
})

describe('catalog_for_name — honest empty (never a fabricated or neighbor value)', () => {
  test('a name absent from the name->slug map returns undefined', () => {
    expect(catalog_for_name('Definitely Not A Real Item Name 12345')).toBeUndefined()
  })
})

describe('live coverage — the honest number, not the 55% claim', () => {
  test('reports what fraction of live item names now resolve a catalog row', () => {
    const names = Object.keys(slugs as Record<string, string>)
    const resolved = names.filter((n) => {
      const slug = (slugs as Record<string, string>)[n]
      return !!slug && !!(catalog as Record<string, unknown>)[slug]
    })
    const pct = (resolved.length / names.length) * 100
    console.log(`  coverage: ${resolved.length}/${names.length} live names resolve a catalog row (${pct.toFixed(1)}%)`)
    // Sanity floor only — NOT the old 55% claim. The honest number is whatever the fresh seed corpus yields;
    // this just guards against a totally broken generator (e.g. an empty catalog) silently passing.
    expect(resolved.length).toBeGreaterThan(0)
    expect(names.length).toBeGreaterThan(0)
  })
})
