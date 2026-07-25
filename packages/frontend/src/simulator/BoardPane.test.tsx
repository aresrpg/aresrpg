// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BoardPane.test.tsx — what the board region actually SHOWS, over react-dom/server (no jsdom; the store
// wiring and the engine mount are the container's, tested by board_paint/reducer instead).
//
// Proven: the DERIVED board's dims + world anchor reach the header, the hint teaches the one gesture the page
// now has (click a cell), and the pane carries NO line-up list of its own — the mob composition is the right
// panel's read-out and the bottom section is gone (#883 ③④).

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'

import { board_of } from './board'
import { BoardPaneView } from './BoardPane'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)

const markup = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <BoardPaneView board={BOARD} on_reroll={() => {}} />
    </I18nextProvider>
  )

describe('the simulator board pane', () => {
  test('the header shows the DERIVED board — its dims, its world anchor, and the reroll', () => {
    const html = markup()
    expect(html).toContain(`${BOARD.width} × ${BOARD.height}`)
    expect(html).toContain(`${BOARD.anchor.x},${BOARD.anchor.z}`)
    expect(html).toContain('REROLL BOARD')
  })

  test('the hint teaches the ONE gesture — a cell click, both bands, place and empty', () => {
    const html = markup()
    expect(html).toContain(en.simulator.board_hint)
    // the two-panel dance is gone: nothing here talks about selecting a roster row first
    expect(html).not.toContain('Select a roster character')
  })

  test('the pane holds no mob line-up of its own — the bottom section was deleted (#883 ④)', () => {
    const html = markup()
    expect(html).not.toContain('MOBS 0/6')
    expect(html).not.toContain(en.simulator.no_mobs)
    // no level inputs, no per-row remove: a mob is edited on its own cell
    expect(html).not.toContain('<input')
  })
})
