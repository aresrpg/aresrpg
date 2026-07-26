// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH SURFACE (#1106) — what this harness can actually execute, split honestly:
//
//   1. The ROW renders for real (renderToStaticMarkup): a true switch (role=switch + aria-checked, never a
//      checkbox) plus the settings cog, in both states.
//   2. The fee disclosure and the settings sheet both reach `createPortal(children, document.body)`, and
//      `document` is genuinely undefined in this repo's bun:test (no jsdom/RTL harness — see
//      contracts_paused_modal.test.tsx, which splits for the same reason). The container's WIRING is proven
//      by source shape instead, and the LAW those affordances rest on — an enable can never arm the loop
//      without the fee confirmation — is driven end to end in auto_search.test.js.
//   3. The MOUNT: the panel sits directly under the world select in the social cluster, DEV builds only.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'

import { AutoSearchRow } from './auto_search_view.jsx'

const test_i18n = i18next.createInstance()
test_i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const panel_source = readFileSync(new URL('./AutoSearchPanel.jsx', import.meta.url), 'utf8')
const hud_source = readFileSync(new URL('../screens/hud/world/GameWorldHud.jsx', import.meta.url), 'utf8')

const render_row = (armed) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <AutoSearchRow armed={armed} on_toggle={() => {}} on_config={() => {}} />
    </I18nextProvider>
  )

describe('the HUD row — a real switch and a cog', () => {
  test('renders a switch (not a checkbox) and the settings cog', () => {
    const html = render_row(false)
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('type="checkbox"')
    expect(html).toContain(`aria-label="${en.auto_search.label}"`)
    expect(html).toContain(`aria-label="${en.auto_search.config_title}"`)
    expect(html).toContain('<svg') // the cog is inline SVG — no icon dependency
  })

  test('the armed state reads back off the switch itself', () => {
    const html = render_row(true)
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('gw-asrch__switch--on')
  })
})

describe('the container wiring — the fee disclosure gates every enable', () => {
  test('the switch dispatches a toggle input; it never arms the loop itself', () => {
    expect(panel_source).toContain("auto_search_input({ type: 'toggle', value: next })")
    // exactly ONE fee_confirm in the file — the dialog's own handler; the switch has no path to it
    expect(panel_source.match(/fee_confirm/g)).toHaveLength(1)
    expect(panel_source).toContain('on_confirm={() => auto_search_input({ type: \'fee_confirm\' })}')
    expect(panel_source).toContain('on_cancel={() => auto_search_input({ type: \'fee_cancel\' })}')
  })

  test('the fee dialog is the house ConfirmDialog, opened by the fold\'s own fee_pending', () => {
    expect(panel_source).toContain('<ConfirmDialog')
    expect(panel_source).toContain('open={fee_pending}')
    expect(panel_source).toContain("t('auto_search.fee_message')")
  })

  test('the cog opens the settings sheet through the door, and the sheet renders on it', () => {
    expect(panel_source).toContain("on_config={() => auto_search_input({ type: 'config_open' })}")
    expect(panel_source).toContain('{config_open && (')
    expect(panel_source).toContain('<AutoSearchSheet')
  })
})

describe('the mount — directly under the world select, DEV builds only', () => {
  test('the panel is rendered after the world switcher inside the social cluster', () => {
    const cluster = hud_source.slice(hud_source.indexOf('className="gw-social"'))
    const world_select = cluster.indexOf('<WorldSwitcher />')
    const panel = cluster.indexOf('<AutoSearchPanel />')
    expect(world_select).toBeGreaterThan(-1)
    expect(panel).toBeGreaterThan(world_select)
  })

  test('the mount is gated on import.meta.env.DEV — every leg it fires is a real transaction', () => {
    const mount_line = hud_source.split('\n').find((line) => line.includes('<AutoSearchPanel />'))
    expect(mount_line).toContain('import.meta.env.DEV')
  })
})
