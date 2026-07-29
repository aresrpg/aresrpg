// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1644 (second half) — OWNER LIVE REPORT 2026-07-29: "Same turn start, the timer showed 6s where the expected
// minimum is 3s… some desync it seem." It was not a desync. `actions::assert_min_turn` gates on the CHAIN's
// turn start and `resolve_from` stamps `deadline = start + turn_ms + 3s × replayed mobs`, so killing one mob
// makes the NEXT turn's minimum 3s + 3s. The rule is right; the screen said nothing, which is what made a
// correct rule read as a bug. This pins that the widened floor NAMES ITSELF on the HUD — and, just as
// importantly, that it stays silent when there is nothing to explain (a line claiming a widening on an
// ordinary 3s turn would be its own lie).

import { afterEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../../../src/i18n/locales/en.json'

// FightControls pulls the browser-flavoured dungeon store (auth registers Enoki at module load) — the same
// narrow host surface the sibling FightControls suite keeps alive for the Bun worker.
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

const EN = i18next.createInstance()
await EN.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const { FightControls } = await import('../../../../src/game/screens/hud/FightControls.jsx')
const { PLAYER_TURN_FLOOR_MS } = await import('@aresrpg/fight/store')
const { seed_fight_core, reset_fight_core } = await import('../../../../src/test_helpers/fight_core_harness.js')

const ME = '0xme'
const TURN_MS = 45_000
const MOB_REPLAY_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved_mobs`

/** Seed a LIVE turn of mine that the chain widened by `mobs_replayed` mobs, and render the controls. */
const render_turn = ({ mobs_replayed }) => {
  const start = Date.now() // the harness stamps `turn_started_at` from the snapshot's own arrival
  seed_fight_core({
    my: ME,
    seats: [{ character: ME }],
    active: ME,
    turn_ms: TURN_MS,
    turn_deadline_ms: start + TURN_MS + mobs_replayed * MOB_REPLAY_MS,
  })
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: EN }, createElement(FightControls, { end_label: 'END TURN' }))
  )
}

/** The rendered widening, in ms. Read numerically: the harness stamps `turn_started_at` from the snapshot's own
 *  arrival, a few ms after this file reads the clock, so the exact figure carries that real scheduling jitter. */
const widened_ms = (html) => Number(html.match(/data-widened-ms="(\d+)"/)?.[1] ?? NaN)

afterEach(reset_fight_core)

describe('#1644 — a min-turn floor the chain widened explains itself', () => {
  test('ONE replayed mob: the HUD names the 6s minimum and why it is 6, not 3', () => {
    const html = render_turn({ mobs_replayed: 1 })
    expect(html, 'the reason line is rendered, not hidden in a hover title').toContain(
      'hud-fightctl__countdown--reason'
    )
    expect(html).toContain(en.fight.turn_min_widened.replace('{{seconds}}', '6'))
    expect(widened_ms(html)).toBeCloseTo(MOB_REPLAY_MS, -2)
  })

  test('TWO replayed mobs: the printed minimum follows the chain’s own dial (9s), never a constant', () => {
    const html = render_turn({ mobs_replayed: 2 })
    expect(html).toContain(en.fight.turn_min_widened.replace('{{seconds}}', '9'))
    expect(widened_ms(html)).toBeCloseTo(2 * MOB_REPLAY_MS, -2)
  })

  test('an ORDINARY 3s turn says nothing — no widening, no line', () => {
    const html = render_turn({ mobs_replayed: 0 })
    expect(html).not.toContain('hud-fightctl__countdown--reason')
    expect(html).not.toContain(en.fight.turn_min_widened.slice(0, 14))
  })

  test('the copy ships in ALL SIX locales, each interpolating the seconds', async () => {
    const locales = ['en', 'fr', 'es', 'de', 'ja', 'uk']
    for (const lng of locales) {
      const bundle = await import(`../../../../src/i18n/locales/${lng}.json`)
      const line = bundle.default.fight?.turn_min_widened
      expect(line, `${lng} is missing fight.turn_min_widened`).toBeString()
      expect(line, `${lng} must interpolate the seconds`).toContain('{{seconds}}')
    }
    expect(PLAYER_TURN_FLOOR_MS).toBe(MOB_REPLAY_MS) // the base floor and the per-mob widening are one 3s fact
  })
})
