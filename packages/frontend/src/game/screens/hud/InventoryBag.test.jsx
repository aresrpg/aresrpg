// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import i18n from '../../../i18n'

mock.module('virtual:item_catalog', () => ({ slugs: {} }))

const { InventoryBag } = await import('./InventoryBag.jsx')

const item = {
  id: '0xsword',
  item_category: 'longsword',
  item_type: 'longsword',
  name: 'Test Longsword',
  amount: 1,
}

const render_bag = (equip_refusal, category = 'equipment') =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <InventoryBag
        category={category}
        set_category={() => {}}
        tabs={[['equipment', 'inventory.equipment']]}
        counts={{ equipment: 1 }}
        total_count={1}
        grid_items={[item]}
        empty_count={0}
        selected_item_id={null}
        equip_lock={null}
        is_removed={() => false}
        is_retry_blocked={() => false}
        equip_refusal={equip_refusal}
        on_select={() => {}}
        on_activate={() => {}}
        on_context_menu={() => {}}
        on_drag_start={() => {}}
        on_drag_end={() => {}}
        on_hover_enter={() => {}}
        on_hover_move={() => {}}
        on_hover_leave={() => {}}
        on_dismiss_tooltip={() => {}}
      />
    </I18nextProvider>
  )

describe('InventoryBag equip pre-flight UI', () => {
  test('a refused equip is disabled and exposes the localized reason', () => {
    const html = render_bag(() => 'errors.equip_level_too_low')

    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('draggable="false"')
    expect(html).toContain(`title="${i18n.t('errors.equip_level_too_low')}"`)
    expect(html).toContain('data-equip-refusal="errors.equip_level_too_low"')
  })

  test('an allowed equip keeps the action enabled and has no invented reason', () => {
    const html = render_bag(() => null)

    expect(html).toContain('aria-disabled="false"')
    expect(html).toContain('draggable="true"')
    expect(html).not.toContain('data-equip-refusal=')
  })

  test('a non-equipment tab keeps its own action enabled even when the item cannot equip', () => {
    const html = render_bag(() => 'errors.equip_not_equippable', 'consumables')

    expect(html).toContain('aria-disabled="false"')
    expect(html).not.toContain('data-equip-refusal=')
    expect(html).not.toContain(`title="${i18n.t('errors.equip_not_equippable')}"`)
  })
})
