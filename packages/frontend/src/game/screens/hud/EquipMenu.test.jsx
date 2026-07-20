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
  test('an equipped fixture row renders the popover with a resolved explorer href', () => {
    const item = { id: '0xabc123', name: 'Test Helmet' }
    const html = render_menu({ x: 12, y: 24, item })
    const url = explorer_object_url('0xabc123')

    expect(url).not.toBeNull()
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('role="menu"')
  })

  test('no menu target renders nothing (native menu still must not fire — that guard is preventDefault upstream)', () => {
    expect(render_menu(null)).toBe('')
  })
})
