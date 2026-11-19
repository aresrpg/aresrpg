// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  DOCS_GUIDES,
  DOCS_ORDER,
  DOCS_REFERENCES,
  docs_path,
  docs_path_of_encyclopedia,
  docs_view,
  is_docs_path,
} from '../../src/docs/routes.ts'
import { ENCYCLOPEDIA_TABS, encyclopedia_route_view } from '../../src/encyclopedia/EncyclopediaContent.tsx'

test('only /docs and its sub-paths select the docs entry', () => {
  expect(['/docs', '/docs/', '/docs/items/old_hoe'].every(is_docs_path)).toBe(true)
  expect(['/', '/docsx', '/world', '/encyclopedia/items', '/agents'].some(is_docs_path)).toBe(false)
})

test('unknown and malformed locations fall back to the overview instead of failing', () => {
  for (const pathname of ['/docs', '/docs/', '/docs/nope', '/elsewhere', '/docs/%E0%A4%A'])
    expect(docs_view(pathname)).toEqual({ kind: 'guide', section: 'overview' })
})

test('every rail section resolves to itself and no section is listed twice', () => {
  expect(new Set(DOCS_ORDER).size).toBe(DOCS_ORDER.length)
  expect([...DOCS_ORDER].sort()).toEqual([...DOCS_GUIDES, ...DOCS_REFERENCES].sort())
  for (const section of DOCS_ORDER) expect(docs_view(docs_path(section)).section).toBe(section)
})

test('reference sections are the encyclopedia views, except its live KARES view', () => {
  const views = ENCYCLOPEDIA_TABS.map(({ id }) => id).filter((id) => id !== 'kares')
  expect([...DOCS_REFERENCES].sort()).toEqual(views.sort())
  // The token is not launched: /docs/kares is a written notice, never the on-chain reading.
  expect(docs_view(docs_path('kares'))).toEqual({ kind: 'guide', section: 'kares' })
})

test('an object link round-trips between the docs and the encyclopedia route space', () => {
  const view = docs_view(docs_path('items', 'key_of_gilded_lorito'))
  if (view.kind !== 'reference') throw new Error('expected a reference view')
  expect(encyclopedia_route_view(view.encyclopedia_path)).toEqual({
    tab: 'items',
    id: 'key_of_gilded_lorito',
    place: null,
  })
  expect(docs_path_of_encyclopedia(view.encyclopedia_path)).toBe('/docs/items/key_of_gilded_lorito')
  expect(docs_path_of_encyclopedia('/encyclopedia/worlds/nauvis/city/thebes')).toBe('/docs/worlds/nauvis/city/thebes')
})
