// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { ItemsTab } from '../../src/encyclopedia/ItemsTab.tsx'

test('items use one expanded collapsible facet rail and no horizontal group filters', () => {
  const html = renderToStaticMarkup(
    <ItemsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      selected_id={null}
      stat_name={(stat) => stat}
      text={(key) => key}
    />
  )

  expect(html.match(/data-item-filter-rail=""/g)).toHaveLength(1)
  for (const group of new Set(encyclopedia_catalog.item_filters.map(({ group }) => group))) {
    expect(html).toContain(`data-item-filter-section="${group}"`)
    expect(html).toContain(`data-item-filter="${group}:`)
  }
  expect(html).toContain('aria-expanded="true"')
  expect(html).not.toContain('group_armor')
  expect(html).not.toContain('group_weapons')
})
