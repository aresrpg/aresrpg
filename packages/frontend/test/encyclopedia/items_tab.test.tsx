// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { ItemsTab } from '../../src/encyclopedia/ItemsTab.tsx'

test('items preserve every authored facet in five compact filter menus', () => {
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

  expect(html.match(/class="aui-filter-options"/g)).toHaveLength(5)
  for (const row of encyclopedia_catalog.item_filters) expect(html).toContain(`data-filter-option="${row.id}"`)
  expect(html).not.toContain('data-item-filter-rail')
})
