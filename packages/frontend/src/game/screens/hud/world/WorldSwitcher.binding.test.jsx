// REGRESSION: the panel claimed "HERE in First Shore" for the FIRST roster
// character while the SELECTED character was another one (in NO world → the app spectates). Mechanism:
// use_rpc_view KEEPS its last-landed data across a deps change (selection switch) and on failed polls,
// so the panel can hold a doc belonging to a DIFFERENT character — and the old component rendered that
// foreign doc's world as the current one with no identity check. The panel must derive its current-world
// line ONLY from a doc whose id matches the selected character; anything else renders the honest
// loading/empty state, never a lying HERE.

import { afterAll, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { T62_WORLDS } from '../../../../chain/deployment'
import { reset_auth_mock } from '../../../../test_helpers/auth_mock.js'

const stale_world = T62_WORLDS[0] // "First Shore" — the world of the FIRST roster character
const SELECTED = '0xselected_character_in_no_world'
const OTHER = '0xfirst_roster_character'

reset_auth_mock()
const [react_i18next, game_store, rpc_view] = await Promise.all([
  import('react-i18next'),
  import('../../../store.js'),
  import('../../../../rpc/use_view'),
])
const spies = [
  // Pass-through useState (renderToStaticMarkup runs no effects/updates): the surface renders its RESTING
  // state — modal closed, nothing expanded — which is exactly where the lying line was reported.
  spyOn(React, 'useState').mockImplementation((initial) => [initial, () => {}]),
  spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: (key, arg) => (typeof arg === 'string' ? arg : key) })),
  spyOn(game_store, 'use_game_state').mockImplementation((selector) => selector({ selected_character_id: SELECTED })),
  // The character-doc view serves the OTHER character's doc (the exact keep-prior-data hook state right
  // after a selection switch / during that character's failed polls). The worlds catalog stays live.
  spyOn(rpc_view, 'use_rpc_view').mockImplementation((_fetcher, options) =>
    options?.interval_ms === 15000
      ? { data: { id: OTHER, world: stale_world.id, level: 12 }, refetch: () => {} }
      : { data: { worlds: [{ world_id: stale_world.id, seed: 1, biome: 'archipelago', required_level: 1 }] }, refetch: () => {} }
  ),
]

const { WorldSwitcher } = await import('./WorldSwitcher.jsx')

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})

test('a doc from a DIFFERENT character never binds the current-world line (no lying HERE)', () => {
  const html = renderToStaticMarkup(<WorldSwitcher />)

  // The stale doc belongs to OTHER — presenting its world as the selected character's location is the
  // reported lie, whatever the surface's exact markup: the label must not appear as the current world.
  expect({
    presents_foreign_world_as_current: html.includes(`>${stale_world.label}<`),
    marks_a_row_here: html.includes('here'),
  }).toEqual({ presents_foreign_world_as_current: false, marks_a_row_here: false })
})
