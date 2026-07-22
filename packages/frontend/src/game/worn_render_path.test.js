// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORN-COSMETIC world regression: the live /v1 Character projection carries a template OBJECT id in
// `worn.<slot>.template_id`; the cosmetic quilt is keyed by the seed appearance slug. Prove the complete
// consumer seam as state in -> rig.set_slots out, including the clearing call on unequip.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'
import { legacy_cosmetic_variants } from '@aresrpg/sdk/deployment/aresrpg'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import '../test_helpers/env_mock.js'
import { SHOP_AVAILABLE, shop } from '../test_helpers/shop_fixture.js'

const { resolve_worn_cosmetics, worn_model_of } = await import('./cosmetic_glb.js')

const seed_manifest = JSON.parse(
  readFileSync(new URL('../../../move/scripts/out/seed_manifest.json', import.meta.url), 'utf8')
)
// MISSING-ARTIFACT (#117): scripts/walrus/out/quilt_receipt_cosmetic_glb_quilt.json is a Walrus-publish
// receipt (content-pipeline output), absent by design in this public repo — mirrors shop_fixture.js's
// SHOP_AVAILABLE guard so only the quilt-dependent assertions below skip.
const QUILT_PATH = fileURLToPath(
  new URL('../../../../scripts/walrus/out/quilt_receipt_cosmetic_glb_quilt.json', import.meta.url)
)
const QUILT_AVAILABLE = existsSync(QUILT_PATH)
const quilt = QUILT_AVAILABLE ? JSON.parse(readFileSync(QUILT_PATH, 'utf8')) : { storedQuiltBlobs: [] }
const quilt_files = new Set(quilt.storedQuiltBlobs.map((row) => row.identifier))
const live_sale_templates = new Set(seed_manifest.shop.map((row) => row.template))

describe('world worn-cosmetic state -> rig slots', () => {
  test('an equipped Fuwa cape joins its /v1 template id to the quilt appearance, then clears on unequip', () => {
    const template_id = '0x257136d3c50daba6f27532573a356e63835c7887aa20186a8399cda689fc5cb6'
    const cape = { item_id: '0xcape', template_id, category: 'cloak' }
    const templates = new Map([
      [
        template_id,
        {
          template_id,
          item_type: 'cloak',
          name: 'Fuwa Cloak (Black)',
          category: 'cloak',
        },
      ],
    ])
    const calls = []
    const rig = { set_slots: (slots) => calls.push(slots) }

    // rpc_to_card preserves `worn` and spreads its category onto the live render character.
    const equipped = { id: '0xcharacter', worn: { cloak: cape }, cloak: cape }
    rig.set_slots(resolve_worn_cosmetics(equipped, templates))
    // A normalized-store merge can retain the old flat compatibility field; the authoritative nested
    // projection is empty after unequip and must win so the rig receives its clearing call.
    rig.set_slots(resolve_worn_cosmetics({ id: '0xcharacter', worn: {}, cloak: cape }, templates))

    expect(calls).toEqual([
      {
        head: null,
        back: { url: 'https://cdn.test/cosmetics/cape_fuwa.glb', variant: 'black' },
      },
      { head: null, back: null },
    ])
  })

  test.skipIf(!SHOP_AVAILABLE || !QUILT_AVAILABLE)(
    'every seeded wearable maps to a shipped base GLB and a world rig slot; title stays display-only',
    () => {
    const counts = shop.cosmetics.reduce((out, row) => {
      out[row.itemType] = (out[row.itemType] ?? 0) + 1
      return out
    }, {})
    // capuche_mo reclassified hat -> cloak 2026-07-17 (the Mo hood is a cloak, not a hat — the
    // GLB is a CAPE-node model; the loop below proves it now mounts at the BACK rig slot like every cloak).
    // Exact per-type totals drift with every seed/economy pass (b0a3f8c6 retired a Bara Hood skin row the
    // same day this suite was last touched) — the real guard is TYPE COVERAGE: shop.json only ever ships
    // the three itemTypes this loop (and the rig) know how to route, and none of them is ever empty.
    expect(Object.keys(counts).sort()).toEqual(['cloak', 'hat', 'title'])
    for (const item_type of ['hat', 'cloak', 'title']) expect(counts[item_type]).toBeGreaterThan(0)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(shop.cosmetics.length)

    const appearances = new Set()
    for (const [index, row] of shop.cosmetics.entries()) {
      const template_id = seed_manifest.items[row.slug]
      expect(live_sale_templates.has(template_id)).toBe(true)
      const item = { item_id: `0xitem${index}`, template_id, category: row.category }
      const templates = new Map([[template_id, { template_id, item_type: row.itemType, name: row.name }]])
      if (row.itemType === 'title') {
        expect(quilt_files.has(`${row.appearance}.glb`)).toBe(false)
        expect(resolve_worn_cosmetics({ worn: { title: item } }, templates)).toEqual({ head: null, back: null })
        continue
      }

      const model = worn_model_of(item, templates)
      expect(model).toEqual({ appearance: row.appearance, variant: row.skin ?? null })
      expect(quilt_files.has(`${model.appearance}.glb`)).toBe(true)
      appearances.add(model.appearance)
      const slot = row.itemType === 'hat' ? 'head' : 'back'
      const resolved = resolve_worn_cosmetics({ worn: { [row.category]: item } }, templates)
      expect(resolved[slot]).toEqual({
        url: `https://cdn.test/cosmetics/${row.appearance}.glb`,
        variant: row.skin ?? null,
      })
    }
    expect(appearances.size).toBe(20)
  })

  test.skipIf(!SHOP_AVAILABLE || !QUILT_AVAILABLE)(
    'corbac is ONE instance: corbac_head owns the art; the helmet duplicate resolves nothing',
    () => {
    // Owner reconciliation 2026-07-17: corbac_helmet was a duplicate of corbac_head — same crow hat under a
    // second name with no GLB of its own (live quilt: corbac_head.glb 200, corbac_helmet.glb 404). Its sale
    // is delisted (0 ever minted); purging the minted duplicate template is a ceremony rider
    // (docs/REPUBLISH_CHECKLIST.md). The repo carries exactly one corbac cosmetic.
    expect(shop.cosmetics.filter((row) => row.slug.includes('corbac')).map((row) => row.slug)).toEqual([
      'corbac_head',
    ])
    const template_id = seed_manifest.items.corbac_head
    expect(live_sale_templates.has(template_id)).toBe(true)
    const model = worn_model_of(
      { template_id },
      new Map([[template_id, { template_id, name: 'Corbac Headdress', item_type: 'hat' }]])
    )
    expect(model).toEqual({ appearance: 'corbac_head', variant: null })
    expect(quilt_files.has('corbac_head.glb')).toBe(true)
    expect(quilt_files.has('corbac_helmet.glb')).toBe(false)

    // The duplicate's Display name must resolve NO model until the rider purges it on-chain — a loud
    // nothing-render, never a silent alias back to life (no-silent-substitute law).
    const helmet_id = seed_manifest.items.corbac_helmet
    expect(
      worn_model_of(
        { template_id: helmet_id },
        new Map([[helmet_id, { template_id: helmet_id, name: 'Corbac Helmet', item_type: 'hat' }]])
      )
    ).toBe(null)
  })

  test.skipIf(!SHOP_AVAILABLE)(
    'the equip RECEIPT re-dresses the rig: a lorito cape swap flips the dress spec before any /v1 confirm',
    () => {
    // Owner bug 2026-07-17: "I equipped a blue lorito cape, but I'm still wearing the previous green one in
    // the world." The rig projects state.sui.characters[i].worn per frame (embed_voxel_player feed →
    // resolve_worn_cosmetics → worn.set_slots), but the ONLY worn writer was reconcile_equip_state's 4×800ms
    // /v1 confirm — on indexer lag it throws and on_accept's catch patches only the BAG, so the rig's input
    // never changes. The client SIGNED the swap tx (client-independence §1): the receipt itself must project
    // the worn transition. This drives the REAL pipeline: reduce_sui_data receipt fold → rig dress spec out.
    const green_row = shop.cosmetics.find((row) => row.slug === 'cape_lorito_agility') // Emerald — the worn one
    const blue_row = shop.cosmetics.find((row) => row.slug === 'cape_lorito_chance') // Sapphire — the bag one
    const green_id = seed_manifest.items[green_row.slug]
    const blue_id = seed_manifest.items[blue_row.slug]
    const templates = new Map([
      [green_id, { template_id: green_id, item_type: 'cloak', name: green_row.name }],
      [blue_id, { template_id: blue_id, item_type: 'cloak', name: blue_row.name }],
    ])
    const green_worn = { item_id: '0xgreen', template_id: green_id, category: 'cloak' }
    const blue_worn = { item_id: '0xblue', template_id: blue_id, category: 'cloak' }

    // State A — the store row exactly as rpc_to_card shapes it (nested worn + flat category spread).
    let sui = {
      characters: [{ id: '0xchar', worn: { cloak: green_worn }, cloak: green_worn }],
      items: [{ id: '0xblue', template_id: blue_id, item_type: 'cloak', name: blue_row.name }],
      xp_floor: {},
    }
    expect(resolve_worn_cosmetics(sui.characters[0], templates).back).toEqual({
      url: 'https://cdn.test/cosmetics/cape_lorito.glb',
      variant: 'agility',
    })

    // The equip receipt (tx SUCCEEDED — digest exists), folded through the one reducer exactly as the
    // Accept path does: the bag deltas, then the worn transition the signed tx proves.
    sui = reduce_sui_data(sui, { kind: 'receipt_patch', op: 'remove_items', ids: ['0xblue'] })
    sui = reduce_sui_data(sui, {
      kind: 'receipt_patch',
      op: 'add_items',
      rows: [{ id: '0xgreen', template_id: green_id, item_type: 'cloak', name: green_row.name }],
    })
    sui = reduce_sui_data(sui, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: '0xchar',
      set: { cloak: blue_worn },
      clear: [],
    })

    // State B — the rig dress spec MUST flip to the blue variant this frame, no /v1 round-trip required.
    expect(resolve_worn_cosmetics(sui.characters[0], templates).back).toEqual({
      url: 'https://cdn.test/cosmetics/cape_lorito.glb',
      variant: 'chance',
    })

    // And the receipt-proven unequip clears the slot the same way.
    const bare = reduce_sui_data(sui, {
      kind: 'receipt_patch',
      op: 'equip_worn',
      character_id: '0xchar',
      set: {},
      clear: ['cloak'],
    })
    expect(resolve_worn_cosmetics(bare.characters[0], templates)).toEqual({ head: null, back: null })
  })

  test.skipIf(!SHOP_AVAILABLE)('all ten Lorito template ids resolve distinct KHR variants after the gem-name renames', () => {
    const current = shop.cosmetics
      .filter((row) => row.appearance === 'cape_lorito')
      .map((row) => [seed_manifest.items[row.slug], row.name, row.skin])
    const renamed_names = {
      air: 'Lorito Cloak (Opal)',
      earth: 'Lorito Cloak (Jade)',
      fire: 'Lorito Cloak (Garnet)',
      water: 'Lorito Cloak (Aquamarine)',
    }
    const renamed = Object.entries(legacy_cosmetic_variants).map(([template_id, { variant }]) => [
      template_id,
      renamed_names[variant],
      variant,
    ])
    const resolved_icons = [...current, ...renamed].map(([template_id, name, variant]) => {
      const model = worn_model_of({ template_id }, new Map([[template_id, { template_id, name, item_type: 'cloak' }]]))
      expect(model).toEqual({ appearance: 'cape_lorito', variant })
      return `${model.appearance}-${model.variant}`
    })

    expect(resolved_icons).toHaveLength(10)
    expect(new Set(resolved_icons).size).toBe(10)
  })

  test('Bara Hood recolor: legacy vitality/wisdom Display names resolve the RENAMED obsidian/moonstone KHR variant', () => {
    // seed-side landed the recolored capuche_bara.glb (new obsidian/moonstone material variants); the seed
    // slug and on-chain Display name never changed (no republish) — only the shipped GLB's variant id did.
    // Already-minted "Bara Hood (Vitality)"/"(Wisdom)" items must keep resolving through cosmetic_icons.js's
    // UNCHANGED annex, then translate through cosmetic_glb.js's RECOLORED_VARIANTS — the one mapping home.
    const vitality_id = seed_manifest.items.capuche_bara_vitality
    const wisdom_id = seed_manifest.items.capuche_bara_wisdom
    const templates = new Map([
      [vitality_id, { template_id: vitality_id, name: 'Bara Hood (Vitality)', item_type: 'hat' }],
      [wisdom_id, { template_id: wisdom_id, name: 'Bara Hood (Wisdom)', item_type: 'hat' }],
    ])
    expect(worn_model_of({ template_id: vitality_id }, templates)).toEqual({
      appearance: 'capuche_bara',
      variant: 'obsidian',
    })
    expect(worn_model_of({ template_id: wisdom_id }, templates)).toEqual({
      appearance: 'capuche_bara',
      variant: 'moonstone',
    })
    // The end-to-end worn-slot path resolves the same recolored variant, not the raw seed word.
    expect(resolve_worn_cosmetics({ worn: { hat: { template_id: vitality_id } } }, templates).head).toEqual({
      url: 'https://cdn.test/cosmetics/capuche_bara.glb',
      variant: 'obsidian',
    })

    // Scoping proof: cape_lorito's OWN "vitality"/"wisdom" KHR variants are a different appearance and stay
    // literal — the recolor rename never leaks onto a cosmetic that merely shares a variant WORD.
    const lorito_vitality_id = seed_manifest.items.cape_lorito_vitality
    expect(
      worn_model_of(
        { template_id: lorito_vitality_id },
        new Map([
          [lorito_vitality_id, { template_id: lorito_vitality_id, name: 'Lorito Cloak (Vitality)', item_type: 'cloak' }],
        ])
      )
    ).toEqual({ appearance: 'cape_lorito', variant: 'vitality' })
  })
})
