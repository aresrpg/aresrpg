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

const { FightControls, FightEndTurnButton, fight_turn_control_phase } = await import('./FightControls.jsx')
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

describe('fight turn controls — one phase source for the button and silent auto-pass', () => {
  test('a LETHAL cast auto-commits after the one turn floor, no manual END TURN (owner ruling 2026-07-21)', () => {
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
    expect(phase, 'the killing blow flips the button to committing — the app fires the turn itself').toBe('committing')
    expect(button.props.disabled).toBe(true)
    expect(submissions, 'a drained lethal prediction auto-commits the turn exactly once (owner ruling)').toBe(1)
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
  })

  test('an armed turn and its chain advance render no auto-pass narration', async () => {
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
    expect(armed).not.toContain('dgb-commit-cue')
    expect(armed).not.toContain('AUTO')

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

  test('a spectator gets one local leave door and no fight inputs', () => {
    const store = seed()
    store.getState().input({ type: 'ctx', ctx: { spectator: true, my_entity_id: null, address: null } })
    const html = renderToStaticMarkup(
      <FightControls abandon_label="FORFEIT" leave_spectate_label="LEAVE" on_leave_spectate={() => {}} />
    )

    expect(html).toContain('hud-fightctl__watching')
    expect(html).toContain('>LEAVE<')
    expect(html).not.toContain('>FORFEIT<')
    expect(html).not.toContain('hud-fightctl__end')
    expect(html).not.toContain('hud-fightctl__ready')
  })

  test('the `state.fight` mirror never returns — a seeded LIVE core leaves game-core state fight-free (S2 kill lock)', async () => {
    // The AP-desync root was a second home for fight truth: `state.fight`, recomputed on
    // core change but delivered a full async dispatch cycle late. The mirror is deleted; this row keeps it dead.
    const { context } = await import('../../store.js')
    seed()
    await new Promise((resolve) => setTimeout(resolve, 25)) // give any resurrected pump its async cycle to show
    expect(context.get_state().fight).toBeUndefined()
  })

  // ── #921 · AN EXPIRED TURN IS NEVER NARRATED ──────────────────────────────────────────────────────────────
  // #882 gave the expired state two banners (stalled red, overdue gold). They were the wrong shape: a player
  // should never read operational instructions about deadlines. The client acts instead — auto-press, auto-
  // crank, console.error — and the action bar says nothing at all about the clock. The FORFEIT door is
  // untouched; it simply no longer has a sign pointing at it.
  test('no expiry banner renders in ANY expired state — the bar keeps only its doors', () => {
    seed()
    const bar = (props) => renderToStaticMarkup(<FightControls abandon_label="FORFEIT" end_label="END TURN" {...props} />)

    for (const props of [
      { fight_status: 1, turn_deadline_ms: Date.now() + 45_000 }, // live
      { fight_status: 1, turn_deadline_ms: Date.now() - 1_000 }, // just lapsed
      { fight_status: 1, turn_deadline_ms: Date.now() - 6 * 3_600_000 }, // the take-7 zombie
      { fight_status: 5, turn_deadline_ms: Date.now() - 6 * 3_600_000 }, // placement's own clock
      { turn_deadline_ms: Date.now() - 6 * 3_600_000 }, // a mount with no chain status at all
    ]) {
      const html = bar(props)
      expect(html).not.toContain('hud-fightctl__notices')
      expect(html).not.toContain('data-fight-stalled')
      expect(html).not.toContain('data-turn-overdue')
    }

    // The exit and the late press both survive: on chain a late END TURN is the legal move that advances the
    // fight (turns.move:177), which is exactly why the client can press it FOR the player.
    const zombie = bar({ fight_status: 1, turn_deadline_ms: Date.now() - 6 * 3_600_000 })
    expect(zombie).toContain('hud-fightctl__abandon')
    expect(zombie).toContain('>FORFEIT<')
    expect(zombie).toContain('hud-fightctl__end')
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
    expect(html).toContain('hud-fightctl__report')
  })
})
