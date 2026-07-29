// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// P0 #1563 — EVERY SEATED FIGHT CRASHED THE CLIENT. `optimistic_vacated`'s useMemo factory (which React runs
// SYNCHRONOUSLY during render) read `resolve_ref` 25 lines ABOVE the `const` that declares it, so the moment a
// viewer was a seated fighter in a live fight (`dungeon` ⋀ `entity_id` both truthy — that guard is the only
// reason the board ever rendered anywhere else) the render threw `ReferenceError: Cannot access 'resolve_ref'
// before initialization` and the whole HUD fell into the error boundary. Shipped by 0c72749b (the #1480
// percent-damage fix); invisible to every gate, because the boundary swallows the throw (no console row, no
// pageerror) and nothing in CI ever drove a seated board mount.
//
// THIS is that missing drive: the REAL component over a REAL @aresrpg/fight fold (init + snapshot →
// project.board_view), not a hand-written board. What IS stubbed are the React↔store BINDINGS, for two
// mechanical reasons and no others:
//   • zustand v5's useStore pins a STATIC render (react-dom/server — this repo has no jsdom) to
//     `getInitialState`, so a seeded store renders every board empty (the same trap game/store.js documents
//     on use_fight_view). The stubs hand the component the SAME live state a subscription would.
//   • `mock.module` is PROCESS-global in bun and three earlier suites already replace game/store.js with a
//     PARTIAL surface (HackRadioPlayer.test.jsx, day_cycle.test.js, marketplace/inventory_panel.test.tsx) —
//     so this file must own that door too, mirroring its FULL export surface. `use_fight_view` still returns
//     the real projection of the real fold: `entity_id` is chain-shaped truth, never a literal.
//
// RED (at 0c72749b…fac99b5f): ReferenceError out of DungeonBoard.jsx's optimistic_vacated memo.
// GREEN: the seated character's board renders.
import { expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../../../../src/test_helpers/browser_globals.js'

// The import graph reaches src/auth/index.ts, which registers the Enoki wallets at module scope (it reads
// window.location and dispatches an app-ready event). Never restored: the module graph below captures these.
install_browser_globals({ with_document: true })

const { renderToStaticMarkup } = await import('react-dom/server')
const i18next = (await import('i18next')).default
const { I18nextProvider } = await import('react-i18next')
const en = (await import('../../../../../src/i18n/locales/en.json')).default
const { fight_store } = await import('@aresrpg/fight/store')
const project = await import('@aresrpg/fight/project')

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x

// A live 1v1 — one seated player (me) and one mob, my turn: the exact shape that crashed on the rig.
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: cell(5, 5),
      stats: { agility: 40 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(8, 5), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

fight_store.getState().input({
  type: 'init',
  fight_id: FIGHT,
  my_key: 'p0',
  ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
})
fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
// The board the app itself publishes: dungeon_run_store.js subscribes the fold and stores project.board_view.
const BOARD = project.board_view(fight_store.getState())

const real_dungeon_store = await import('../../../../../src/world-shell/dungeon_store.js')
const real_dungeon_turn = await import('../../../../../src/game/screens/dungeon-turn.js')
const real_roster = await import('../../../../../src/roster/store')

// A zustand hook that answers from LIVE state under a static render (see the header note on getInitialState).
const static_hook = (store, state) => Object.assign((selector = (s) => s) => selector(state), store)

// The engine state this board reads: a seat the WALLET does not own (#1001) — its identity resolves off the
// fight's own fighter book, the same path a simulator/spectator seat takes.
const GAME_STATE = { sui: { characters: [] }, world_presentation: 'terrain' }

mock.module('../../../../../src/game/store.js', () => ({
  use_game_state: (selector = (s) => s) => selector(GAME_STATE),
  use_fight_view: () => project.fight_view(),
  use_fight: (selector = (s) => s) => selector(fight_store.getState()),
  context: { get_state: () => GAME_STATE, events: { on() {}, off() {} } },
}))
mock.module('../../../../../src/world-shell/dungeon_store.js', () => ({
  ...real_dungeon_store,
  use_dungeon: static_hook(real_dungeon_store.use_dungeon, {
    ...real_dungeon_store.use_dungeon.getState(),
    dungeon: BOARD,
    character_id: CHAR,
  }),
}))
mock.module('../../../../../src/game/screens/dungeon-turn.js', () => ({
  ...real_dungeon_turn,
  use_dungeon_turn: static_hook(real_dungeon_turn.use_dungeon_turn, real_dungeon_turn.use_dungeon_turn.getState()),
}))
mock.module('../../../../../src/roster/store', () => ({
  ...real_roster,
  use_expedition: static_hook(real_roster.use_expedition, real_roster.use_expedition.getState()),
}))

const { DungeonBoard } = await import('../../../../../src/game/screens/hud/world/DungeonBoard.jsx')

const test_i18n = i18next.createInstance()
void test_i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const render_board = () => {
  try {
    return {
      html: renderToStaticMarkup(
        <I18nextProvider i18n={test_i18n}>
          <DungeonBoard />
        </I18nextProvider>
      ),
    }
  } catch (error) {
    // The app's error boundary swallows this throw. The test must not.
    return { html: '', error }
  }
}

test('a seated fighter mounts the fight board instead of throwing into the error boundary (#1563)', () => {
  const { html, error } = render_board()

  // The regression itself: a temporal-dead-zone read from a render-time memo. The failure output keeps the
  // runtime's own wording (a browser names the binding: "Cannot access 'resolve_ref' before initialization").
  expect(`${error?.name ?? ''} ${error?.message ?? ''}`).not.toMatch(/before initialization/)
  expect(error).toBeUndefined()

  // …and the board is actually THERE: the seated character's own controls, not an empty or boundary render.
  expect(html).toContain(`data-controlled-character="${CHAR}"`)
})
