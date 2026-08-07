// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The radio SELF-GATES on the live session's presentation — that is the whole mount contract: off the grid it
// renders nothing (so no manifest is ever fetched), on the grid it renders the micro-label, the track line and
// the play/pause control. This repo's convention is renderToStaticMarkup with no jsdom (see
// PetFeedModal.test.jsx), which is exactly the right instrument here: it renders the markup WITHOUT running
// effects, so the gate is asserted with no network and no channel handoff. The chain that feeds the gate is
// covered at both ends: the session's publish (source wiring, the embed_voxel_lifecycle.test.js idiom) and the
// reducer's fold. The radio's own BEHAVIOUR — manifest → tracks, ended → advance, loop, failure → error row —
// is headless by construction and lives in hack_radio.test.js.
//
// `mock.module` is PROCESS-global in bun and another suite already mocks game/store.js — so this file must
// own its own store mock or it inherits that one's state shape and renders nothing.
// Assertions are on STRUCTURE, never on translated text: react-i18next's default instance is process-global
// too. The strings are covered by the key/locale contract below plus the ×6 i18n coverage gate.
import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../../i18n/locales/en.json'
import { install_browser_globals } from '../../../../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })
let game_state = /** @type {any} */ ({ world_presentation: 'terrain', fight_mode: false })
mock.module('../../../store.js', () => ({
  useGameState: (/** @type {(state: any) => any} */ selector) => selector(game_state),
}))

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const { HackRadioPlayer } = await import('./HackRadioPlayer.jsx')
const player_module = (await import('../../../core/modules/player.js')).default

/** Render the widget with the live session on `presentation` (+ optional fight_mode) — the two flags it gates on. */
function render(presentation, fight_mode = false) {
  game_state = { world_presentation: presentation, fight_mode }
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(HackRadioPlayer, null)))
}

/** Walk a dotted i18n key into a catalog. @returns {unknown} */
const resolve_key = (catalog, key) => key.split('.').reduce((node, part) => node?.[part], catalog)

afterAll(() => restore_browser_globals())

describe('the hack-mode album radio', () => {
  test('renders NOTHING off the hack grid — a normal session never sees it', () => {
    expect(render('terrain')).toBe('')
    expect(render(undefined)).toBe('') // a torn-down session folds back to terrain, radio included
  })

  test('on the grid it shows the micro-label, the track line and the play control', () => {
    const html = render('hackgrid')
    expect(html).toContain('gw-radio__lbl')
    expect(html).toContain('gw-radio__track')
    expect(html).toContain('gw-radio__btn')
    expect(html).toContain('aria-label=') // the control always announces its action
    // The FIRST paint is paused by construction: autoplay is an effect, and this renderer runs none. That the
    // engine starts itself — and how it survives a browser refusing it — is hack_radio.test.js's job.
    expect(html).toContain('▶')
  })

  test('the control cancels the pending autoplay retry on its own pointerdown, before its click toggles', () => {
    const source = readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')
    expect(source).toContain('onPointerDown={on_pointer_down}')
    expect(source).toContain('useCallback(radio_dismiss_gesture_retry, [])')
  })

  test('#2260 it OWNS no playback — the element, the manifest and the cursor all live in the latch', () => {
    const source = readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')
    expect(source).not.toContain('create_radio') // no engine construction on a mount
    expect(source).not.toContain('load_radio_tracks') // no manifest fetch on a mount
    expect(source).toContain('useSyncExternalStore(subscribe_radio, radio_snapshot, radio_snapshot)')
    // armed once, and with NO cleanup — an unmount must never stop the album
    expect(source).toContain('arm_radio_latch()')
    expect(source).toContain('}, [])')
  })

  test('it is TEXT ONLY — no player region, no iframe, no third-party embed survives', () => {
    const html = render('hackgrid')
    expect(html).not.toContain('iframe')
    expect(html).not.toContain('gw-radio__screen')
    const source = readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')
    expect(source).not.toContain('youtube')
    expect(source).not.toContain('<img')
  })

  test('before a track exists the control is disabled — never a play button that does nothing', () => {
    expect(render('hackgrid')).toContain('disabled=""')
  })

  test('the session publishes its presentation through the reducer door, and clears it on teardown', () => {
    const source = readFileSync(new URL('../../../embed_voxel.js', import.meta.url), 'utf8')
    expect(source).toContain("context.dispatch('action/world_presentation', presentation)")
    expect(source).toContain("context.dispatch('action/world_presentation', 'terrain')")
  })

  test('the reducer door normalizes the session presentation — anything but the grid is terrain', () => {
    const { reduce } = player_module()
    const fold = (payload) => reduce({}, { type: 'action/world_presentation', payload }).world_presentation
    expect(fold('hackgrid')).toBe('hackgrid')
    expect(fold('terrain')).toBe('terrain')
    expect(fold(undefined)).toBe('terrain') // session teardown / an unknown payload never leaves the grid on
  })

  test('the channel handoff stands the beds down OUT of a fight, and gives the channel straight back mid-fight', () => {
    const latch = readFileSync(new URL('./hack_radio_latch.js', import.meta.url), 'utf8')
    // ONE derived call off the OBSERVED slice — never a mount/unmount pair (the handoff used to flip on both)
    expect(latch).toContain('set_music_stream_owned(!channel_held())')
    // the widget cannot flip the channel at all any more — it does not even reach the music module
    expect(readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')).not.toContain(
      "from '../../../core/audio/ambient_music.js'"
    )
  })

  test('a fight pauses/resumes the SAME radio engine — never a rebuild that restarts the album at track one', () => {
    const latch = readFileSync(new URL('./hack_radio_latch.js', import.meta.url), 'utf8')
    expect(latch).toContain('channel_held: channel_held()')
    expect(latch).toContain('radio?.set_channel_held(channel_held())')
    // the ONE construction door, behind the delta fold — a fight edge can never reach it
    expect(latch).toContain('if (radio || tracks.length === 0) return')
  })

  test('the control disables during a fight — a click can never resume the album mid-fight', () => {
    const source = readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')
    expect(source).toContain('disabled={fight_mode || failed || !track}')
  })

  test('the widget persists across every page: GameWorldHost mounts it route-independently, not GameWorldHud', () => {
    const host_source = readFileSync(new URL('../../../../GameWorldHost.tsx', import.meta.url), 'utf8')
    expect(host_source).toContain("import('./game/screens/hud/world/HackRadioPlayer.jsx')")
    // gated on `in_app` ALONE (never `active`, which is only true on the world tab) — the exact gate that
    // used to hide it on every other route.
    expect(host_source).toContain('{in_app && (')
    expect(host_source).toContain('<HackRadioPlayer />')
    const hud_source = readFileSync(new URL('./GameWorldHud.jsx', import.meta.url), 'utf8')
    expect(hud_source).not.toContain('<HackRadioPlayer') // one home — the route-gated HUD no longer renders it
    expect(hud_source).not.toContain("from './HackRadioPlayer.jsx'") // nor imports it
  })

  test('its corner is fixed to the VIEWPORT, not the world-tab canvas frame, so it survives every route', () => {
    const css = readFileSync(new URL('./game-world-hud.css', import.meta.url), 'utf8')
    const block = css.slice(css.indexOf('.gw-radio {'), css.indexOf('.gw-radio__text'))
    expect(block).toContain('position: fixed;')
  })

  test('every string it renders ships in the locales', () => {
    const source = readFileSync(new URL('./HackRadioPlayer.jsx', import.meta.url), 'utf8')
    const keys = [...source.matchAll(/t\('(world\.[^']+)'\)/g)].map(([, key]) => key)
    expect(keys).toHaveLength(5) // label, track placeholder, error line, play, pause
    for (const key of keys) expect(typeof resolve_key(en, key)).toBe('string')
  })
})
