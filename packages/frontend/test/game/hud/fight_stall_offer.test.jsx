// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1381 ② — THE STALL IS VISIBLE, AND IT IS AN OFFER.
//
// Live finding: "when a teammate ends their turn the partner's client keeps showing the old turn ticking, and a
// stalling player could freeze the fight for everyone by never passing." The overdue predicate already existed
// (fight_expiry_gate.js) and the bar already computed it — into a `console.error`. Every other player therefore
// sat in front of a dead clock with no door.
//
// What this drives, through the REAL component and the REAL fight core:
//   · an overdue OTHER turn, past the grace every janitor needed, renders the stall line + a FORCE PASS door;
//   · rendering it fires NOTHING (auto-forcing would grief a slow-but-alive player and burn gas doing it);
//   · a turn still inside its deadline renders neither — the offer is not a permanent decoration;
//   · MY OWN late turn never offers it: that one auto-presses END TURN (the chain grants the late press grace).
import { afterEach, describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../../src/i18n/locales/en.json'
import { install_browser_globals } from '../../../src/test_helpers/browser_globals.js'
import { EXPIRY_GRACE_MS } from '../../../src/world-shell/fight_expiry_gate.js'

const restore_browser_globals = install_browser_globals()
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

const { FightControls } = await import('../../../src/game/screens/hud/FightControls.jsx')
const { seed_fight_core, reset_fight_core } = await import('../../../src/test_helpers/fight_core_harness.js')

const EN = i18next.createInstance()
await EN.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

const ME = '0xme'
const ALT = '0xalt'
const SEATS = [{ character: ME }, { character: ALT }]
const STATUS_ACTIVE = 1

/** The bar as the dungeon/world board mounts it, with the chain status + deadline the expiry gate reads. */
const render = ({ active, turn_deadline_ms, on_force_pass = () => {} }) => {
  seed_fight_core({ my: ME, seats: SEATS, active, turn_deadline_ms, version: 2 })
  return renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <FightControls
        placement={false}
        show_abandon={false}
        end_label="END"
        fight_status={STATUS_ACTIVE}
        turn_deadline_ms={turn_deadline_ms}
        on_force_pass={on_force_pass}
      />
    </I18nextProvider>
  )
}

/** Past the grace every watching client's crank needed — the fight is genuinely not moving. */
const stalled_deadline = () => Date.now() - EXPIRY_GRACE_MS - 5_000

afterEach(reset_fight_core)

describe('#1381 ② · a stalled turn offers the other players one door', () => {
  test('RED: an overdue OTHER turn renders the stall line and a FORCE PASS button', () => {
    const markup = render({ active: ALT, turn_deadline_ms: stalled_deadline() })
    expect(markup).toContain('hud-fightctl__force-pass')
    expect(markup).toContain('FORCE PASS')
    expect(markup).toContain('is not ending their turn')
  })

  test('the offer is never auto-fired — rendering it composes no transaction at all', () => {
    let presses = 0
    render({
      active: ALT,
      turn_deadline_ms: stalled_deadline(),
      on_force_pass: () => {
        presses += 1
      },
    })
    expect(presses).toBe(0)
  })

  test('a turn still inside its deadline offers nothing (the janitors have not even had their window)', () => {
    const markup = render({ active: ALT, turn_deadline_ms: Date.now() + 30_000 })
    expect(markup).not.toContain('hud-fightctl__force-pass')
    expect(markup).not.toContain('is not ending their turn')
  })

  test('an overdue turn INSIDE the grace still offers nothing — the auto-crank owns that window', () => {
    const markup = render({ active: ALT, turn_deadline_ms: Date.now() - Math.floor(EXPIRY_GRACE_MS / 2) })
    expect(markup).not.toContain('hud-fightctl__force-pass')
  })

  test('MY OWN late turn is never offered a force pass (it auto-presses END TURN instead)', () => {
    const markup = render({ active: ME, turn_deadline_ms: stalled_deadline() })
    expect(markup).not.toContain('hud-fightctl__force-pass')
    expect(markup).toContain('hud-fightctl__end')
  })
})

process.on('exit', restore_browser_globals)
