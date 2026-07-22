// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#500): a PUBLIC fight already in battle is an actionable observer door, not the grey wave-2 stub.
import { afterAll, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { install_browser_globals } from '../../../../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../../../test_helpers/auth_mock.js'

const restore_browser_globals = install_browser_globals()
reset_auth_mock()
const { FightRow } = await import('./FightsModal.jsx')

afterAll(restore_browser_globals)

const active_public_fight = {
  id: '0xwatch',
  public: true,
  status: 'active',
  started: true,
  participant_count: 2,
  participant_ids: ['0xalice', '0xbob'],
  distance: 12,
}

const render_row = (marker = active_public_fight) =>
  renderToStaticMarkup(
    <FightRow
      marker={marker}
      dungeon={false}
      is_friend={false}
      group_member={false}
      selected={false}
      busy={false}
      on_hover={() => {}}
      on_join={() => {}}
      on_watch={() => {}}
      t={(key) => key}
    />
  )

describe('FightsModal WATCH', () => {
  test('a public in-battle fight renders WATCH enabled', () => {
    const html = render_row()
    expect(html).toContain('>fights.spectate</button>')
    expect(html).not.toContain('disabled=""')
  })
})
