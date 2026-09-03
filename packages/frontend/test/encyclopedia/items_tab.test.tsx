// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

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
  for (const group of ['category', 'resource', 'job', 'world', 'family']) {
    expect(html).toContain(`data-item-filter-section="${group}"`)
    expect(html).toContain(`data-item-filter="${group}:`)
  }
  expect(html).toContain('aria-expanded="true"')
  expect(html).toContain('data-item-filter="world:nauvis:plains"')
  expect(html).toContain('data-item-filter="world:nauvis:thebes"')
  expect(html).toContain('data-item-filter="resource:pet_food"')
  expect(html).not.toContain('group_armor')
  expect(html).not.toContain('group_weapons')
})

test('pet food uses its derived category in the list and detail view', () => {
  const html = renderToStaticMarkup(
    <ItemsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      selected_id="gilded_pet_food"
      stat_name={(stat) => stat}
      text={(key) => key}
    />
  )

  expect(html).toContain('item_category_pet_food')
  expect(html).toContain('group_pet_food_resources')
})

test('recipe and ingredient-of rows display their canonical item icons', () => {
  const html = renderToStaticMarkup(
    <ItemsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      selected_id="can_openers"
      stat_name={(stat) => stat}
      text={(key) => key}
    />
  )

  expect(html).toContain('data-encyclopedia-item-icon="quartzbound_scrap"')
  expect(html).toContain('data-encyclopedia-item-icon="quartz_honed_beak"')

  const ingredient_html = renderToStaticMarkup(
    <ItemsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      selected_id="quartzbound_scrap"
      stat_name={(stat) => stat}
      text={(key) => key}
    />
  )
  expect(ingredient_html).toContain('data-encyclopedia-item-icon="can_openers"')
})

test('dropped-by rows display the canonical mob picture', () => {
  const html = renderToStaticMarkup(
    <ItemsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      selected_id="lorito_feather"
      stat_name={(stat) => stat}
      text={(key) => key}
    />
  )

  expect(html).toContain('data-encyclopedia-mob-icon=')
})
