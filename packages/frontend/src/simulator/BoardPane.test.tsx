// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BoardPane.test.tsx — what the board region actually SHOWS, over react-dom/server (no jsdom; the store
// wiring and the engine mount are the container's, tested by board_paint/reducer instead).
//
// Proven: the DERIVED board's dims + world anchor reach the header, the hint states which of the two modes
// the page is in (a character focused or not), an empty enemy band says so rather than rendering a phantom
// row, and a mob whose combat block is UNPUBLISHED (seam S2) is badged — never quietly completed with
// invented stats.

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'
import type { CorpusMob } from '../pages/encyclopedia/world_corpus'

import { board_of } from './board'
import { BoardPaneView, type PickedRow } from './BoardPane'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)

/** Two authored mobs: one WITH a published combat block, one without (the S2 degrade). */
const GRONK: CorpusMob = {
  id: 'gronk',
  name: 'Gronk',
  element: null,
  role: 'trash',
  minLevel: 10,
  maxLevel: 20,
  base_hp: 340,
  ap: 6,
  mp: 3,
}
const WISP: CorpusMob = { id: 'wisp', name: 'Aether Wisp', element: 'air', role: 'trash', minLevel: 5, maxLevel: 12 }

const markup = (picked: readonly PickedRow[], focused = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <BoardPaneView
        board={BOARD}
        picked={picked}
        focused={focused}
        on_reroll={() => {}}
        on_level={() => {}}
        on_remove={() => {}}
      />
    </I18nextProvider>
  )

describe('the simulator board pane', () => {
  test('the header shows the DERIVED board — its dims, its world anchor, and the reroll', () => {
    const html = markup([])
    expect(html).toContain(`${BOARD.width} × ${BOARD.height}`)
    expect(html).toContain(`${BOARD.anchor.x},${BOARD.anchor.z}`)
    expect(html).toContain('REROLL BOARD')
  })

  test('with nothing focused the pane says what to do instead of ignoring clicks silently', () => {
    expect(markup([])).toContain('Select a roster character')
    expect(markup([], true)).toContain('Click a blue cell')
  })

  test('an empty enemy band renders the honest empty state, never a phantom row', () => {
    const html = markup([])
    expect(html).toContain('NO MOBS')
    expect(html).toContain('MOBS 0/6')
  })

  test('a picked mob lists its name + level; an UNPUBLISHED combat block is badged, never faked', () => {
    const html = markup([
      { cell: BOARD.start_cells_b[0], pick: { template_id: 'gronk', level: 12 }, row: GRONK },
      { cell: BOARD.start_cells_b[1], pick: { template_id: 'wisp', level: 7 }, row: WISP },
    ])
    expect(html).toContain('Gronk')
    expect(html).toContain('Aether Wisp')
    expect(html).toContain('value="12"')
    expect(html).toContain('MOBS 2/6')
    // exactly ONE badge — gronk publishes its hp, the wisp does not
    expect(html.split('NO COMBAT BLOCK').length - 1).toBe(1)
  })

  test('a pick whose corpus row vanished still renders (by id) rather than disappearing silently', () => {
    const html = markup([{ cell: BOARD.start_cells_b[0], pick: { template_id: 'mob_ghost', level: 3 }, row: null }])
    expect(html).toContain('mob_ghost')
  })
})
