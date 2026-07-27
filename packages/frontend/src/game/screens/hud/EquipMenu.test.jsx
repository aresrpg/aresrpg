// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import i18n from '../../../i18n'
import { explorer_object_url } from '../../../components/explorer_link'

import { EquipMenu } from './EquipMenu.jsx'

const render_menu = (menu) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <EquipMenu menu={menu} on_close={() => {}} />
    </I18nextProvider>
  )

describe('EquipMenu (right-click on an EQUIPPED slot)', () => {
  // #1226 — equipping WRAPS the item into its character, so the item id leaves Sui global storage and its
  // explorer page 404s. Every item this menu renders is equipped by construction, so the row must link the
  // CHARACTER's page (top-level, real — the item shows there as a nested field), never the wrapped item id.
  test('an equipped fixture links the CHARACTER page, not the wrapped item id', () => {
    const item = { id: '0xabc123', name: 'Test Helmet' }
    const html = render_menu({ x: 12, y: 24, item, character_id: '0xcafe01' })
    const url = explorer_object_url('0xcafe01')

    expect(url).not.toBeNull()
    expect(html).toContain(`href="${url}"`)
    expect(html).not.toContain(explorer_object_url('0xabc123'))
    expect(html).toContain('View equipped on Explorer')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('role="menu"')
    expect(html).toContain(i18n.t('gift.send.send_items'))
    expect(html).toContain(`title="${i18n.t('gift.send.unequip_first')}"`)
    expect(html).toContain('disabled=""')
  })

  test('no menu target renders nothing (native menu still must not fire — that guard is preventDefault upstream)', () => {
    expect(render_menu(null)).toBe('')
  })
})
