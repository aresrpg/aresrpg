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
//   3. The MOUNT: the panel sits directly under the world select in the social cluster, on the hack grid (no
//      build-mode gate — the fee modal is the money safety, not the build).

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
const adapter_source = readFileSync(new URL('./auto_search_adapter.js', import.meta.url), 'utf8')
const css_source = readFileSync(new URL('./auto-search.css', import.meta.url), 'utf8')
const hud_source = readFileSync(new URL('../screens/hud/world/GameWorldHud.jsx', import.meta.url), 'utf8')

/** One CSS rule's declaration block, by selector — the styling assertions read the shipped sheet, not a copy. */
const css_rule = (selector) => {
  const at = css_source.indexOf(`${selector} {`)
  return at === -1 ? '' : css_source.slice(at, css_source.indexOf('}', at))
}

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

  // Control contract: label … cog · switch, the switch flush RIGHT, and ROUNDED.
  test('the row reads label → cog → switch, with the switch LAST (flush right)', () => {
    const html = render_row(false)
    const label = html.indexOf('gw-asrch__label')
    const cog = html.indexOf('gw-asrch__cog')
    const swtch = html.indexOf('role="switch"')
    expect(label).toBeGreaterThan(-1)
    expect(cog).toBeGreaterThan(label)
    expect(swtch).toBeGreaterThan(cog)
    // nothing follows the switch in the row — the label's `flex: 1` is what pins it to the right edge
    expect(html.slice(swtch)).not.toContain('gw-asrch__cog')
    expect(css_rule('.gw-asrch__label')).toContain('flex: 1')
  })

  test('the switch is a PILL — rounded track, circular knob, gold when armed', () => {
    expect(css_rule('.gw-asrch__switch')).toContain('border-radius: 999px')
    expect(css_rule('.gw-asrch__knob')).toContain('border-radius: 50%')
    expect(css_rule('.gw-asrch__switch--on')).toContain('--color-gold')
    expect(css_rule('.gw-asrch__switch--on .gw-asrch__knob')).toContain('--color-gold')
  })

  test('the cog is one closed gear outline at the switch\'s height, with a grown hit area', () => {
    const html = render_row(false)
    expect(html).toContain('width="15"') // the icon matches the 16px switch height
    expect(html.match(/<path /g)).toHaveLength(1) // ONE outline — never the old bundle of spokes
    expect(html).toContain('stroke-width="1.5"') // one consistent stroke across teeth and hub
    expect(css_rule('.gw-asrch__cog::after')).toContain('inset: -5px') // the tap target, at zero row height
  })
})

describe('the container wiring — the fee disclosure gates every enable', () => {
  test('the switch dispatches a toggle input; it never arms the loop itself', () => {
    expect(panel_source).toContain("auto_search_input({ type: 'toggle', value: next })")
    // exactly ONE fee_confirm DISPATCH in the file — the dialog's own handler; the switch has no path to it.
    // (Counted on the dispatch, not the bare word: it also names a comment and the confirm button's i18n key.)
    expect(panel_source.match(/type: 'fee_confirm'/g)).toHaveLength(1)
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

describe("the wanted list — scoped to the CURRENT WORLD's own mob table", () => {
  test('the picker is filtered by the world table the panel reads', () => {
    expect(panel_source).toContain('const world_mob_ids = useWorldMobIds()')
    expect(panel_source).toContain('useMobTemplates(config_open || armed, world_mob_ids)')
    expect(adapter_source).toContain('world_mob_ids.has(String(mob.template_id))')
  })

  test('the table is the World doc the zone derivation already caches — never a new fetch', () => {
    expect(adapter_source).toContain("import { zone_world_doc } from '../zone_rows.js'")
    expect(adapter_source.match(/useRpcView\(/g)).toHaveLength(1) // the bestiary read, and only it
  })

  test('an unknown table serves NO rows — never the whole global bestiary', () => {
    expect(adapter_source).toContain('const rows = world_mob_ids')
    expect(adapter_source).toContain('    : []')
  })

  test('a world switch prunes the selection through the fold\'s door, not a store write', () => {
    expect(adapter_source).toContain("auto_search_input({ type: 'world_mobs', template_ids })")
    expect(adapter_source).not.toContain('useAutoSearch.setState')
  })
})

describe('the mount — directly under the world select, on the hack grid', () => {
  test('the panel is rendered after the world switcher inside the social cluster', () => {
    const cluster = hud_source.slice(hud_source.indexOf('className="gw-social"'))
    const world_select = cluster.indexOf('<WorldSwitcher />')
    const panel = cluster.indexOf('<AutoSearchPanel />')
    expect(world_select).toBeGreaterThan(-1)
    expect(panel).toBeGreaterThan(world_select)
  })

  test('the mount rides the hack-grid seam, never the build mode', () => {
    const mount_line = /** @type {string} */ (hud_source.split('\n').find((line) => line.includes('<AutoSearchPanel />')))
    // Reachable on EVERY build the moment hack mode is armed (it is the dev entry's surface, like the hack
    // radio) — a build-mode gate here would silently un-ship it from edge. The money safety is the fee modal
    // on each enable, driven end to end in auto_search.test.js.
    expect(mount_line).not.toContain('import.meta.env')
    expect(mount_line).toContain('hack_grid')
    // ...and it stays exploration-only and embodied-only, exactly like the world select above it.
    expect(mount_line).toContain('!fight_mode && has_character')
  })
})
