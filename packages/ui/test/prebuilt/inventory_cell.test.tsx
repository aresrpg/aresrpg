// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { InventoryCell } from '../../src/index.ts'

test('the inventory cell keeps its selection hook, art and corner figures', () => {
  const html = renderToStaticMarkup(
    <InventoryCell
      id="item-1"
      label="Hat"
      icon="hat.webp"
      fallback="H"
      amount={12}
      level={7}
      pending
      class_name="is-selected"
      data-marketplace-owned-item="item-1"
    />
  )
  expect(html).toContain(
    '<button data-selection-id="item-1" class="chr-cell is-selected" aria-label="Hat" aria-busy="true" type="button" data-marketplace-owned-item="item-1">'
  )
  expect(html).toContain('<img alt="" class="chr-cell__art" draggable="false" src="hat.webp"/>')
  expect(html).toContain('<span class="inventory-item-pending" aria-hidden="true"></span>')
  expect(html).toContain('<span class="chr-cell__amount">×12</span>')
  expect(html).toContain('<span class="chr-cell__lvl">7</span>')
})

test('a single unit without art shows its letter and no figures', () => {
  const html = renderToStaticMarkup(
    <InventoryCell id="i" label="Zephyr" icon={null} fallback="Z" amount={1} level={null} />
  )
  expect(html).toContain('<span class="chr-cell__fallback">Z</span>')
  expect(html).toContain('<span class="inventory-item-pending" hidden="" aria-hidden="true"></span>')
  expect(html).not.toContain('chr-cell__amount')
  expect(html).not.toContain('chr-cell__lvl')
})
