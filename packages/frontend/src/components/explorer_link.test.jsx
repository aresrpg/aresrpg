// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for the inventory context-menu's "See on explorer" row (right-click
// an item, reach its on-chain object page). ExplorerMenuRow is the ONE shared row every popover (pet/box/crush)
// renders — proven here in isolation; crush_menu.test.tsx proves one real menu actually wires it in.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import i18n from '../i18n'

import { ExplorerMenuRow, explorer_object_url } from './explorer_link'

const render = (object_id) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ExplorerMenuRow object_id={object_id} />
    </I18nextProvider>
  )

describe('ExplorerMenuRow — the right-click "See on explorer" row', () => {
  test('a real on-chain item id renders a new-tab link to its object page', () => {
    const html = render('0xabc123')
    const url = explorer_object_url('0xabc123')
    expect(url).not.toBeNull()
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).toContain('View on Explorer')
  })

  // #1226 control — a kiosk-held UNEQUIPPED item is a real top-level object, so its page resolves: the
  // custody-aware change must leave this path byte-identical (direct item-id link, plain label).
  test('an unequipped (kiosk-held) item keeps the DIRECT item-id link', () => {
    const html = render('0xbeef99')
    expect(html).toContain(`href="${explorer_object_url('0xbeef99')}"`)
    expect(html).toContain('View on Explorer')
    expect(html).not.toContain('View equipped on Explorer')
  })

  test('a template-only item (no valid on-chain id) renders nothing — never a dead link', () => {
    expect(render(null)).toBe('')
    expect(render(undefined)).toBe('')
    expect(render('not-an-id')).toBe('')
  })
})
