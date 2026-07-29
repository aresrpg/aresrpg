// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixture tests for the item-display census pure helpers. The RED-FIRST anchor is
// `diff_object_vs_template`: the real production bug (a minted object whose `name` froze an old value while
// its template already carries the corrected one) MUST be bucketed `stale`. A template-only census — the
// pre-existing blind spot — reports it consistent; that is the red this test pins.
import { expect, test } from 'bun:test'

import {
  HISTORICAL_COSMETIC_NAMES,
  classify_image_url,
  diff_object_vs_template,
  index_by_id,
  index_by_item_type,
  interpolate_display,
  item_type_collisions,
  template_seed_convergence,
} from './item_display_census.mjs'

const id = (n) => `0x${String(n).padStart(64, '0')}`

// The real chain shape (from the GraphQL census 2026-07-20): the AIR template is now "Opal" but an object
// minted earlier still says "Emerald"; a genuine Emerald object matches; an object on a deleted template.
const AIR_TMPL = '0xb9b0fb6110e158cd67dc79f003d5b2ac7d06c8720280ed27a59eb70dbb075cef'
const AGILITY_TMPL = '0xf296a0233b9e055364eae64e4f5cf639105c8e846b71ec7008162b8f8af213a1'
const objects = [
  { id: id(1), template: AIR_TMPL, name: 'Lorito Cloak (Emerald)', item_type: 'cloak' }, // STALE (tmpl=Opal)
  { id: id(2), template: AGILITY_TMPL, name: 'Lorito Cloak (Emerald)', item_type: 'cloak' }, // consistent
  { id: id(3), template: id(99), name: 'Ghost', item_type: 'cloak' }, // orphan (template unread)
]
const template_name_by_id = {
  [AIR_TMPL]: 'Lorito Cloak (Opal)',
  [AGILITY_TMPL]: 'Lorito Cloak (Emerald)',
}

test('diff_object_vs_template flags the frozen mint-time snapshot as stale (the production bug)', () => {
  const { stale, consistent, orphan } = diff_object_vs_template(objects, template_name_by_id)
  expect(stale.map((r) => r.id)).toEqual([id(1)])
  expect(stale[0]).toMatchObject({
    object_name: 'Lorito Cloak (Emerald)',
    template_name: 'Lorito Cloak (Opal)',
    item_type: 'cloak',
    template: AIR_TMPL,
  })
  expect(consistent.map((r) => r.id)).toEqual([id(2)])
  expect(orphan.map((r) => r.id)).toEqual([id(3)])
})

test('diff_object_vs_template is empty-safe', () => {
  expect(diff_object_vs_template([], {})).toEqual({ stale: [], consistent: [], orphan: [] })
  expect(diff_object_vs_template(undefined, undefined)).toEqual({ stale: [], consistent: [], orphan: [] })
})

test('interpolate_display substitutes object fields and leaves unknown tokens literal', () => {
  const fields = { name: '{name}', image_url: '/assets/items/{item_type}.png', description: '{description}' }
  const resolved = interpolate_display(fields, { name: 'Lorito Cloak (Opal)', item_type: 'cloak' })
  expect(resolved.name).toBe('Lorito Cloak (Opal)')
  expect(resolved.image_url).toBe('/assets/items/cloak.png') // slot word — non-discriminating
  expect(resolved.description).toBe('{description}') // absent field stays literal (how Display renders it)
})

test('classify_image_url — relative is dead on explorers; slot-word absolute is unresolved', () => {
  expect(classify_image_url('/assets/items/cloak.png')).toMatchObject({ kind: 'relative', explorer_ok: false })
  expect(classify_image_url('https://cdn.aresrpg.world/x/{item_type}.png')).toMatchObject({
    kind: 'absolute',
    unresolved: true,
    explorer_ok: false,
    host: 'cdn.aresrpg.world',
  })
  expect(classify_image_url('https://cdn.aresrpg.world/x/white_whool.png')).toMatchObject({
    kind: 'absolute',
    explorer_ok: true,
  })
})

test('item_type_collisions — slot words shared by >1 template vs unique', () => {
  const templates = [
    { id: id(1), item_type: 'cloak' },
    { id: id(2), item_type: 'cloak' },
    { id: id(3), item_type: 'hat' },
    { id: id(4), item_type: 'hat' },
    { id: id(5), item_type: 'white_whool' },
  ]
  const c = item_type_collisions(templates)
  expect(c.shared_types).toBe(2)
  expect(c.shared_templates).toBe(4)
  expect(c.unique_count).toBe(1)
  expect(c.shared.cloak).toEqual([id(1), id(2)])
})

test('index_by_id — first-wins, id-validated', () => {
  const map = index_by_id([
    { id: id(1), name: 'A' },
    { id: id(1), name: 'B' }, // dup ignored
    { id: 'not-an-id', name: 'C' },
  ])
  expect(map).toEqual({ [id(1)]: 'A' })
})

test('template_seed_convergence — a diverged template (rename never landed) is surfaced', () => {
  const result = template_seed_convergence({
    expected_name_by_slug: { cape_lorito_air: 'Lorito Cloak (Opal)', cape_lorito_x: 'Missing' },
    template_name_by_slug: { cape_lorito_air: 'Lorito Cloak (Opal)', cape_lorito_x: 'WRONG' },
  })
  expect(result.converged.map((r) => r.slug)).toEqual(['cape_lorito_air'])
  expect(result.diverged.map((r) => r.slug)).toEqual(['cape_lorito_x'])
})

test('template_seed_convergence follows stable item_type identity across a republish', () => {
  const current_templates = [
    { id: id(42), item_type: 'cape_lorito_air', name: 'Lorito Cloak (Opal)' },
  ]
  const result = template_seed_convergence({
    expected_name_by_slug: { cape_lorito_air: 'Lorito Cloak (Opal)' },
    template_name_by_slug: index_by_item_type(current_templates),
  })

  expect(result).toEqual({
    converged: [{ slug: 'cape_lorito_air', name: 'Lorito Cloak (Opal)' }],
    diverged: [],
    missing: [],
  })
})

test('HISTORICAL_COSMETIC_NAMES pins the delisted element family (the Opal source of truth)', () => {
  expect(HISTORICAL_COSMETIC_NAMES.cape_lorito_air).toBe('Lorito Cloak (Opal)')
})
