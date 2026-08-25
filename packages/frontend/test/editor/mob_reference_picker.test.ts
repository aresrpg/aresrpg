// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import mobs from '../../../../seed/content/mobs.json'
import worlds from '../../../../seed/content/worlds.json'
import { mob_picker_facets } from '../../src/editor/MobReferencePicker.tsx'
import { mob_filter_rows } from '../../src/editor/content_list.ts'
import { entity_rows, type JsonValue } from '../../src/editor/seed_editor.ts'

test('the mob picker exposes world, biome, family, and element facets for its candidates', () => {
  const filters = mob_filter_rows(
    entity_rows('mobs', mobs as unknown as JsonValue),
    entity_rows('worlds', worlds as unknown as JsonValue)
  )
  const facets = mob_picker_facets(new Set(['fuwa__white', 'fuwa__black']), filters)
  const ids = facets.map(({ id }) => id)

  expect(ids).toContain('world:nauvis')
  expect(ids.some((id) => id.startsWith('biome:nauvis:'))).toBeTrue()
  expect(ids).toContain('family:fuwa')
  expect(ids.some((id) => id.startsWith('element:'))).toBeTrue()
  expect(facets.filter(({ id }) => id.startsWith('biome:')).every(({ parent }) => parent === 'nauvis')).toBeTrue()
})
