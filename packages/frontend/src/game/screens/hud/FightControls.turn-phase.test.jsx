// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { fight_layer_class } from './mobile_layout.js'

// FightControls imports the browser-flavoured dungeon store (auth registers Enoki at module load).
// Keep this narrow host surface alive for the Bun worker: deleting `window` in an afterAll races other files'
// module initialization when the scoped game suite runs concurrently.
const w = /** @type {any} */ (globalThis.window ??= /** @type {any} */ ({}))
w.addEventListener ??= () => {}
w.removeEventListener ??= () => {}
w.matchMedia ??= () => ({ matches: false })
w.location ??= { origin: 'http://localhost:5173', href: 'http://localhost:5173/' }
w.location.href ??= 'http://localhost:5173/'
w.dispatchEvent ??= () => true
globalThis.localStorage ??= /** @type {any} */ ({ getItem: () => null, setItem() {}, removeItem() {} })
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}
// Seeding the REAL fight core (S2 mirror kill) trips the fight edge module's combat-music leg — stub the
// browser Audio element the ambient engine instantiates (no sound in a headless worker, obviously).
globalThis.Audio ??= /** @type {any} */ (
  class {
    play() {
      return Promise.resolve()
    }
    pause() {}
    addEventListener() {}
    removeEventListener() {}
  }
)

const { FightControls, FightEndTurnButton, fight_turn_control_phase, turn_commit_countdown_s } =
  await import('./FightControls.jsx')
const { engine_view } = await import('@aresrpg/fight/project')
const { PLAYER_TURN_FLOOR_MS } = await import('@aresrpg/fight/store')
const { subscribe_commit_due } = await import('@aresrpg/fight/txs')
const { seed_fight_core, reset_fight_core } = await import('../../../test_helpers/fight_core_harness.js')

const ME = '0xme'
const ALT = '0xalt'
const MOB = 'mob-0'

const fight_state = (overrides = {}) => ({
  active_entity_id: ME,
  my_entity_id: ME,
  fighters: new Map([
    [ME, { id: ME }],
    [MOB, { id: MOB }],
  ]),
  winner: -1,
  spectator: false,
  presenting: false,
  placement: false,
  ready: new Set(),
  ...overrides,
})

// Drive the REAL fight core through its ONE input door (S2 mirror kill — `state.fight` is gone; components
// read the projected view synchronously via use_fight_view). The slice-shaped `fight_state` literals above
// keep serving the PURE fns (fight_turn_control_phase) untouched; the hook-path tests seed the core.
const seed = ({ active = ME, my = ME, seats = [{ character: ME }], version = 1 } = {}) =>
  seed_fight_core({ my, seats, active, version, turn_deadline_ms: Date.now() + 90_000 })

afterEach(reset_fight_core)

describe('fight turn controls — one phase source for the button and countdown', () => {
  test('a cast stays END-TURN armed after the one turn floor while its receipt is still absent', () => {
    const store = seed()
    const start = store.getState().turn_started_at
    let dungeon_busy = false
    let submissions = 0
    const receipt_pending = new Promise(() => {})
    const stop = subscribe_commit_due(store, {
      submit: () => {
        submissions += 1
        dungeon_busy = true // DungeonBoard flush → dungeon_store.commit_turn's synchronous control feed
        return receipt_pending
      },
    })

    store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } })
    store.getState().input({
      type: 'stage',
      intent: { kind: 1, target: 105, spell_template_id: '0xspell', spell_key: 'ghost_talon' },
    })
    store.getState().input({
      type: 'predicted',
      intent_id: 'cast:no-receipt',
      actions: [
        { kind: 'cast', target_cell: 105, damaging: true, ap_cost: 3 },
        { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 },
      ],
    })
    store.getState().input({ type: 'tick' }, start + PLAYER_TURN_FLOOR_MS)

    const phase = fight_turn_control_phase(engine_view(store.getState()), dungeon_busy)
    const button = FightEndTurnButton({ phase, on_end_turn: () => {}, end_label: 'END' })
    expect(phase, 'END TURN stays armed after the one per-turn floor without waiting on a receipt').toBe('armed')
    expect(button.props.disabled).toBe(false)
    expect(submissions, 'a prediction cannot auto-submit before its receipt confirms the committed kill').toBe(0)
    stop()
  })

  test('click enters the disabled committing phase synchronously, before chain acknowledgement', () => {
    const mine = fight_state()
    let busy = false
    const render_button = () => {
      const phase = fight_turn_control_phase(mine, busy)
      return FightEndTurnButton({
        phase,
        on_end_turn: () => {
          busy = true // dungeon_store.commit_turn's synchronous optimistic edge
        },
        end_label: 'END',
      })
    }

    const armed = render_button()
    expect(armed.props.disabled).toBe(false)
    armed.props.onClick() // the actual button handler; no receipt/turn event has landed

    const pressed = render_button()
    expect(mine.active_entity_id).toBe(ME) // chain turn has not advanced
    expect(fight_turn_control_phase(mine, busy)).toBe('committing')
    expect(pressed.props.disabled).toBe(true)
    expect(renderToStaticMarkup(pressed)).toContain('disabled=""')
    expect(turn_commit_countdown_s('committing', true, 40_000, 30_000)).toBeNull()
  })

  test('the map-resolved phase is the only countdown gate', () => {
    const deadline_ms = 40_000
    expect(fight_turn_control_phase(fight_state(), false)).toBe('armed')
    expect(fight_turn_control_phase(fight_state({ active_entity_id: 'missing' }), false)).toBe('hidden')
    expect(fight_turn_control_phase(fight_state({ presenting: true }), false)).toBe('hidden')
    expect(turn_commit_countdown_s('armed', true, deadline_ms, 30_000)).toBe(10)
    expect(turn_commit_countdown_s('hidden', true, deadline_ms, 30_000)).toBeNull()
    expect(turn_commit_countdown_s('armed', false, deadline_ms, 30_000)).toBeNull()
  })

  test('a chain turn-advance event unmounts END TURN and its cue without a click', async () => {
    seed()
    let clicks = 0
    const props = {
      placement: false,
      show_abandon: false,
      end_label: 'END',
      has_turn_draft: true,
      turn_deadline_ms: Date.now() + 10_000,
      auto_commit_label: (n) => `AUTO ${n}`,
      on_end_turn: () => {
        clicks += 1
      },
    }
    const armed = renderToStaticMarkup(<FightControls {...props} />)
    expect(armed).toContain('hud-fightctl__end')
    expect(armed).toContain('dgb-commit-cue')
    expect(armed).toContain('AUTO')

    seed({ active: MOB, version: 2 })

    const advanced = renderToStaticMarkup(<FightControls {...props} />)
    expect(clicks).toBe(0)
    expect(advanced).not.toContain('hud-fightctl__end')
    expect(advanced).not.toContain('dgb-commit-cue')
    expect(advanced).not.toContain('AUTO')
  })

  test('an authoritative next-owned turn rekeys the rendered controls from character A to B', async () => {
    const two_seats = [{ character: ME }, { character: ALT }]
    seed({ seats: two_seats })
    const props = { placement: false, show_abandon: false, end_label: 'END' }
    const initial = renderToStaticMarkup(<FightControls {...props} />)
    expect(initial).toContain('hud-fightctl__end')
    expect(initial).toContain(`data-controlled-character="${ME}"`)

    seed({ seats: two_seats, my: ALT, active: ALT, version: 2 })

    const switched = renderToStaticMarkup(<FightControls {...props} />)
    expect(switched).toContain('hud-fightctl__end')
    expect(switched).toContain(`data-controlled-character="${ALT}"`)
    expect(switched).not.toContain(`data-controlled-character="${ME}"`)
  })

  test('the `state.fight` mirror never returns — a seeded LIVE core leaves game-core state fight-free (S2 kill lock)', async () => {
    // The AP-desync root was a second home for fight truth: `state.fight`, recomputed on
    // core change but delivered a full async dispatch cycle late. The mirror is deleted; this row keeps it dead.
    const { context } = await import('../../store.js')
    seed()
    await new Promise((resolve) => setTimeout(resolve, 25)) // give any resurrected pump its async cycle to show
    expect(context.get_state().fight).toBeUndefined()
  })

  test('mobile placement renders READY and FORFEIT inside the compact fight-layer modifier', async () => {
    seed()
    const html = renderToStaticMarkup(
      <div className={fight_layer_class(true)}>
        <div className="hud-bottom">
          <FightControls placement ready_label="READY" abandon_label="FORFEIT" />
        </div>
      </div>
    )

    expect(html).toContain('gw-fight-layer--mobile')
    expect(html).toContain('hud-fightctl__ready')
    expect(html).toContain('>READY<')
    expect(html).toContain('hud-fightctl__abandon')
    expect(html).toContain('>FORFEIT<')
  })
})
