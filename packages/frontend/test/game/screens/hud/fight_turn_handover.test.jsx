// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1808 — OWNER PLAYTEST 2026-08-02 (mobile, testnet): the turn UI mounted, then a line appeared — "Turn minimum
// 49s — the mobs that just played are still resolving on chain" — and play was blocked. Verbatim-grade report:
// "if it's my turn to play then it's my turn — don't let me play if it's not."
//
// #1644 answered the same symptom by EXPLAINING the widened floor. That was the wrong half: a turn that must be
// explained was never handed over honestly. This drives the controls with artificially slow mob resolution and
// pins the boundary instead — no turn UI before the turn is playable, no blocking line on the happy path, and a
// plain waiting treatment in between (the same grammar the fight already uses for another actor's turn).

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
const { fight_store } = await import('@aresrpg/fight/store')
const { seed_fight_core, reset_fight_core } = await import('../../../../src/test_helpers/fight_core_harness.js')

const ME = '0xme'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`
const END_LABEL = 'END TURN'

/** Seed a LIVE turn of mine that the chain widened by `mobs_replayed` mobs' resolution, and render the controls. */
const render_turn = ({ mobs_replayed }) => {
  const start = Date.now() // the harness stamps the fold from the snapshot's own arrival
  seed_fight_core({
    my: ME,
    seats: [{ character: ME }],
    active: ME,
    turn_ms: TURN_MS,
    turn_deadline_ms: start + TURN_MS + mobs_replayed * MOB_RESOLVE_MS,
  })
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: EN }, createElement(FightControls, { end_label: END_LABEL }))
  )
}

afterEach(reset_fight_core)

describe('#1808 — a turn granted once, when it is genuinely playable', () => {
  test('mob resolution still running on chain: no turn UI, no numbers, just an honest wait', () => {
    const html = render_turn({ mobs_replayed: 16 }) // the reported shape — a 48s widened window
    expect(fight_store.getState().turn_playable, 'the chain has not finished handing the turn over').toBe(false)
    expect(html, 'the END TURN control must not mount before the turn is playable').not.toContain(END_LABEL)
    expect(html, 'the plain waiting treatment stands in for it').toContain(en.dungeons.waiting)
  })

  test('nothing blocks the happy path: an ordinary turn arms its controls immediately', () => {
    const html = render_turn({ mobs_replayed: 0 })
    expect(fight_store.getState().turn_playable).toBe(true)
    expect(html).toContain(END_LABEL)
    expect(html, 'no waiting treatment on a turn that is already mine').not.toContain(en.dungeons.waiting)
  })

  test('the granted-then-retracted line is GONE — from the render and from every locale', async () => {
    const html = render_turn({ mobs_replayed: 16 })
    expect(html, 'the widened-floor reason line is deleted, not reworded').not.toContain(
      'hud-fightctl__countdown--reason'
    )
    for (const fragment of ['resolving', 'on chain', 'minimum', 'Turn minimum'])
      expect(html, `player copy must not leak mechanics ("${fragment}")`).not.toContain(fragment)
    for (const lng of ['en', 'fr', 'es', 'de', 'ja', 'uk']) {
      const bundle = await import(`../../../../src/i18n/locales/${lng}.json`)
      expect(bundle.default.fight?.turn_min_widened, `${lng} still carries the deleted copy`).toBeUndefined()
    }
  })
})
