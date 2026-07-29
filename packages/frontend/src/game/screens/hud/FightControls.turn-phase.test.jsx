// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
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

const EN_I18N = i18next.createInstance()
await EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const NARROW_LABEL_I18N = i18next.createInstance()
await NARROW_LABEL_I18N.init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        fight: { bug_report: 'COPY BUG REPORT' },
        fights: { spectating: 'WATCHING FIGHT', leave_spectate: 'LEAVE SPECTATE' },
      },
    },
  },
  interpolation: { escapeValue: false },
})

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
    [MOB, { id: MOB, name: 'Sewer Rat' }],
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

  test('the map-resolved phase is the only countdown gate', () => {
    const deadline_ms = 40_000
    expect(fight_turn_control_phase(fight_state(), false)).toBe('armed')
    expect(fight_turn_control_phase(fight_state({ active_entity_id: 'missing' }), false)).toBe('hidden')
    expect(fight_turn_control_phase(fight_state({ presenting: true }), false)).toBe('hidden')
    expect(fight_turn_control_phase(fight_state({ active_entity_id: MOB }), false)).toBe('waiting')
    expect(fight_turn_control_phase(fight_state({ active_entity_id: MOB, winner: 0 }), false)).toBe('hidden')
    expect(fight_turn_control_phase(fight_state({ active_entity_id: MOB, spectator: true }), false)).toBe('hidden')
    // HONEST DEADLINE (#323): the cue counts to the AUTO-COMMIT FIRE moment (deadline − COMMIT_BUFFER_MS 5s),
    // the same honest deadline FightTimeline shows — NOT the raw chain deadline (that read 10 while the turn
    // actually locked in 5). Raw gap 10s → honest window 5s.
    expect(turn_commit_countdown_s('armed', true, deadline_ms, 30_000)).toBe(5)
    expect(turn_commit_countdown_s('hidden', true, deadline_ms, 30_000)).toBeNull()
    expect(turn_commit_countdown_s('armed', false, deadline_ms, 30_000)).toBeNull()
  })

  test('a chain-anchored off-turn actor gets a named disabled control, never a spend door', () => {
    const phase = fight_turn_control_phase(fight_state({ active_entity_id: MOB }), false)
    let clicks = 0
    const button = FightEndTurnButton({
      phase,
      on_end_turn: () => {
        clicks += 1
      },
      end_label: 'END',
      disabled_label: 'Waiting for Sewer Rat',
    })

    expect(phase).toBe('waiting')
    expect(button.props.disabled).toBe(true)
    expect(renderToStaticMarkup(button)).toContain('Waiting for Sewer Rat')
    expect(clicks).toBe(0)
  })

  test('the cue reaches 0 exactly when the background commit fires, never at the raw chain deadline (#323)', () => {
    const deadline_ms = 45_000 // a default 45s turn; the auto-commit fires at 40_000 (deadline − 5s buffer)
    // at the fire moment the honest cue reads 0 (the turn is locking now) …
    expect(turn_commit_countdown_s('armed', true, deadline_ms, 40_000)).toBe(0)
    // … while the raw chain deadline still has 5s to run — the over-promise this fix removes.
    expect(turn_commit_countdown_s('armed', true, deadline_ms, 40_000)).not.toBe(5)
  })

  test('a chain turn-advance disables END TURN with the active fighter name and removes its cue', async () => {
    const seats = [
      { character: ME, name: 'Me' },
      { character: ALT, name: 'Aster' },
    ]
    seed({ seats })
    let clicks = 0
    const props = {
      placement: false,
      show_abandon: false,
      end_label: 'END',
      has_turn_draft: true,
      turn_deadline_ms: Date.now() + 10_000,
      turn_deadline_label: (n) => `DEADLINE ${n}`,
      on_end_turn: () => {
        clicks += 1
      },
    }
    const armed = renderToStaticMarkup(<FightControls {...props} />)
    expect(armed).toContain('hud-fightctl__end')
    // #1381: the deadline is VISIBLE on your own armed turn — a HUD with no clock is the worse product.
    expect(armed).toContain('dgb-commit-cue')
    expect(armed).toContain('DEADLINE')
    // #1003's real cure survives in the COPY: nothing is narrated as an auto pass, ever.
    expect(armed).not.toContain('AUTO')

    const store = seed({ seats, active: ALT, version: 2 })
    store.getState().input({ type: 'ctx', ctx: { roster: [{ id: ALT, name: 'Aster' }] } })

    const advanced = renderToStaticMarkup(
      <I18nextProvider i18n={EN_I18N}>
        <FightControls {...props} />
      </I18nextProvider>
    )
    expect(clicks).toBe(0)
    expect(advanced).toContain('hud-fightctl__end')
    expect(advanced).toContain('disabled=""')
    expect(advanced).toContain('Waiting for Aster')
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
    const bar = (props) =>
      renderToStaticMarkup(<FightControls abandon_label="FORFEIT" end_label="END TURN" {...props} />)

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

  test('1280px and 1024px fight bars keep every full control label inside its box (#1607)', () => {
    const end_turn = renderToStaticMarkup(
      <FightEndTurnButton
        phase="committing"
        on_end_turn={() => {}}
        end_label="END TURN"
        disabled_label="END TURN · 6"
      />
    )
    expect(end_turn).toContain('>END TURN · 6<')

    const store = seed()
    store.getState().input({ type: 'ctx', ctx: { spectator: true, my_entity_id: null, address: null } })
    const spectator = renderToStaticMarkup(
      <I18nextProvider i18n={NARROW_LABEL_I18N}>
        <FightControls on_leave_spectate={() => {}} />
      </I18nextProvider>
    )
    expect(spectator).toContain('>WATCHING FIGHT<')
    expect(spectator).toContain('>COPY BUG REPORT<')

    // Bun's DOM renderer cannot calculate painted glyph boxes. Pin the CSS side of the same contract using
    // the repo's established block-scoped overflow assertions: at either requested viewport the bar can be
    // narrowed by its host, so labels must wrap inside their own boxes instead of relying on clipped overflow.
    const css = [
      readFileSync(new URL('./hud.css', import.meta.url), 'utf8'),
      readFileSync(new URL('./mobile-fight-hud.css', import.meta.url), 'utf8'),
    ].join('\n')
    const button_rule = css.match(/\.hud-fightctl \.hud-fightctl__btn\s*\{[^}]*\}/)?.[0] ?? ''
    const watching_rule = css.match(/\.hud-fightctl__watching\s*\{[^}]*\}/)?.[0] ?? ''

    expect(button_rule).toContain('max-width: 100%')
    expect(button_rule).toContain('white-space: normal')
    expect(button_rule).toContain('overflow-wrap: anywhere')
    expect(watching_rule).toContain('max-width: 100%')
    expect(watching_rule).toContain('white-space: normal')
    expect(watching_rule).toContain('overflow-wrap: anywhere')

    // THE COMPACT HOST IS THE ONLY ONE THAT CAN CLIP (measured 2026-07-29 in a real browser at 1280×800 and
    // 1024×768): the desktop `.hud-bottom` is shrink-to-fit with room to spare, so even the pre-fix rules
    // never truncated there. `.gw-fight-layer--mobile .hud-bottom` is a hard `width: 104px`, and the buttons
    // inside it only stay readable because they INHERIT the wrapping from the base rule asserted above —
    // the mobile rule itself sets `min-width: 0` and never re-states it. Re-introducing `nowrap` (or an
    // `overflow: hidden`) on THIS rule would restore #1607 while every assertion above still passed, so the
    // compact host guards its own actionable buttons here.
    const mobile_button_rule =
      css.match(/\.gw-fight-layer--mobile \.hud-fightctl \.hud-fightctl__btn\s*\{[^}]*\}/)?.[0] ?? ''
    expect(mobile_button_rule).not.toBe('')
    expect(mobile_button_rule).not.toContain('white-space: nowrap')
    expect(mobile_button_rule).not.toContain('overflow: hidden')
    expect(mobile_button_rule).not.toContain('text-overflow: ellipsis')
  })
})
