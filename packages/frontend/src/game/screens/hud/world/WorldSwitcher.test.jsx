// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The collapsed WORLD PANEL (redesigned from an earlier "too big and polluting" layout): ONE compact
// identity-guarded row — globe + the bare world label (the localized "you are in <world>" sentence rides
// the title, same i18n key) + a small inline travel text-button (short `join` label; `travel_cta` as
// title/aria) — the picker rows moved into WorldTravelModal (closed at rest; its lock/filter logic is
// unit-proven on the pure derivations in world_travel_state.test.js, and rendered gates are asserted e2e by
// test/gold/specs_anchor/world_gate.spec.ts).

import { afterAll, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { T62_WORLDS } from '../../../../chain/deployment'
import { reset_auth_mock } from '../../../../test_helpers/auth_mock.js'

const world = T62_WORLDS[0]
const translate = (key, values = {}) =>
  key === 'world_switcher.in_world' ? `You are in ${values.world}` : key

reset_auth_mock()
const [react_i18next, game_store, rpc_view] = await Promise.all([
  import('react-i18next'),
  import('../../../store.js'),
  import('../../../../rpc/use_view'),
])
// Mutated per test: the character-doc poll's latest value (the worlds catalog stays constant).
let doc = /** @type {{ id: string, world: string | null, level: number } | null} */ (null)
const spies = [
  spyOn(React, 'useState').mockImplementation((initial) => [initial, () => {}]),
  spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: translate })),
  spyOn(game_store, 'use_game_state').mockImplementation((selector) =>
    selector({ selected_character_id: '0xcharacter' })
  ),
  spyOn(rpc_view, 'use_rpc_view').mockImplementation((_fetcher, options) =>
    options?.interval_ms === 15000
      ? { data: doc, refetch: () => {} }
      : {
          data: { worlds: [{ world_id: world.id, seed: 7, biome: 'archipelago', required_level: 1 }] },
          refetch: () => {},
        }
  ),
]

const { WorldSwitcher } = await import('./WorldSwitcher.jsx')

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})

test('in a world → ONE compact row: bare label visible, the full sentence on the title, inline travel button', () => {
  doc = { id: '0xcharacter', world: world.id, level: 3 }
  const html = renderToStaticMarkup(<WorldSwitcher />)

  expect({
    // Visible text = the bare world label (the compact idiom), NOT the full sentence…
    bare_label: html.includes(`>${world.label}</span>`),
    // …which survives on the line's title (the in_world i18n key stays live).
    sentence_on_title: html.includes(`title="You are in ${world.label}"`),
    line_binds_world_id: html.includes(`data-world="${world.id}"`),
    // The travel action is the SHORT join label; the long travel_cta sentence rides title/aria only.
    travel_label_short: html.includes('>world_switcher.join</button>'),
    travel_cta_on_aria: html.includes(`aria-label="world_switcher.travel_cta"`),
    // The chunky two-row layout is gone: no line-wrapper div, no old picker rows.
    old_line_wrapper: html.includes('gw-worlds__line'),
    old_picker_rows: html.includes('gw-worlds__row'),
  }).toEqual({
    bare_label: true,
    sentence_on_title: true,
    line_binds_world_id: true,
    travel_label_short: true,
    travel_cta_on_aria: true,
    old_line_wrapper: false,
    old_picker_rows: false,
  })
})

test('in NO world → the honest empty state, with the travel button as the call-to-action', () => {
  doc = { id: '0xcharacter', world: null, level: 1 }
  const html = renderToStaticMarkup(<WorldSwitcher />)

  expect({
    empty_line: html.includes('world_switcher.no_world'),
    travel_is_cta: html.includes('gw-worlds__travel cta'),
  }).toEqual({ empty_line: true, travel_is_cta: true })
})
