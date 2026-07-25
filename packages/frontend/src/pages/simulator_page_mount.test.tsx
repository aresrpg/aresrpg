// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator_page_mount.test.tsx — the /simulator route's L0 shell actually MOUNTS.
//
// The nav tab shipped disabled while the rebuilt page was already routed, so nothing ever proved the
// destination behind it renders. This does: the lazy route's module resolves, SimulatorPage renders over
// react-dom/server (the house's no-jsdom convention — BoardPane.test.tsx), and the three panes the spec
// names are in the markup. The engine is lazy-imported in a mount effect, so the shell costs no GLB here.

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// The SAME dynamic import app.tsx's lazy route performs — a broken module surfaces here, not in a browser.
const { SimulatorPage } = await import('./simulator')

const markup = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <SimulatorPage />
    </I18nextProvider>
  )

describe('the /simulator route mounts', () => {
  test('the lazy route module exports the page component app.tsx renders', () => {
    expect(typeof SimulatorPage).toBe('function')
  })

  test('the L0 shell renders its top bar and the three panes', () => {
    const html = markup()
    expect(html).toContain(en.simulator.title)
    expect(html).toContain(en.simulator.roster)
    expect(html).toContain(en.simulator.board)
    // YOUR team left, the board middle, the ENEMY team right — the third pane is the mob roster now, not a
    // standing inspector (the editors are modals a seat opens).
    expect(html).toContain(en.simulator.mob_team)
  })

  test('the roster shows every empty slot as a create affordance rather than dead space', () => {
    expect(markup().split(en.simulator.new_character).length - 1).toBeGreaterThan(1)
  })

  // #883 ③ — the enemy panel is a READ-OUT: no seat of it is a button, and it invites no picking (that door
  // is the red cell itself). An empty seat still says EMPTY rather than rendering as dead space.
  test('the enemy panel is inert — a composition read-out, not a second picking door', () => {
    const html = markup()
    expect(html).not.toContain(en.simulator.pick_mob)
    expect(html.split(en.simulator.seat_empty).length - 1).toBeGreaterThan(1)
  })

  // #883 ⑤ — the page had no way at all to start a fight. It is in the top bar, disabled until a character
  // stands on the board, and it says WHY while it is.
  test('a START FIGHT control exists, disabled until at least one character is placed', () => {
    const html = markup()
    expect(html).toContain(en.simulator.start_fight)
    expect(html).toContain('disabled=""')
    expect(html).toContain(en.simulator.fight_blocked_empty_roster)
  })

  test('no editor is mounted until a seat is opened — the page is seats, not a standing form', () => {
    const html = markup()
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain(en.simulator.equipment)
  })
})
