// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #369 — the level-up card read translucent (the live world/nameplate bled through the ground) and
// auto-dismissed itself on a timer instead of waiting for the player's choice. Two pins:
//
// (a) DISMISS CONTRACT — no timer-driven hide; only the explicit Allocate/Later buttons unmount the card.
// This repo's HUD component tests are SSR-only (renderToStaticMarkup, no jsdom/happy-dom dependency — see
// PetFeedModal.test.jsx), and `useEffect` never runs under SSR, so a mounted-DOM
// timer-fired proof isn't reachable without adding a new dependency. The mechanical pin is therefore the
// static file shape: LevelUp.jsx must contain no `setTimeout` at all (its only historical use WAS the
// auto-dismiss). This was RED before the fix (the timer existed) and is GREEN after (deleted).
//
// (b) OPAQUE GROUND — the card root carries `.result--fe`, the SAME opaque #07080c + vignette plate
// FightReport's fight-end card already uses (result.css), replacing the translucent `.result` base alone.
//
// (c) RADIANT CEREMONY (owner pick, round3-radiant — follow-up the same day) — the card root ALSO carries
// `radiant` (levelup-radiant.css), the ember/gold ceremony skin layered on top of the opaque floor. Plain
// class-presence pin, same rationale as (b): SSR proves markup shape, not animation/visual fidelity.
import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

reset_auth_mock()
const [game_store] = await Promise.all([import('../../store.js')])
const state = {
  level_up: { level: 5, levels_gained: 1, stat_points: 5, spell_points: 1 },
  fight_result: null,
  sui: { characters: [] },
  selected_character_id: null,
}
const spies = [spyOn(game_store, 'use_game_state').mockImplementation((selector) => selector(state))]

const { LevelUp } = await import('./LevelUp.jsx')

const render = () => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(LevelUp)))

describe('LevelUp — issue #369: opaque ground + no auto-dismiss', () => {
  test('the card root carries the opaque .result--fe canon, not the translucent glass alone', () => {
    const html = render()
    const root_class = html.match(/<div class="(result[^"]*)"/)?.[1]
    expect(root_class?.split(' ')).toContain('result--fe')
  })

  test('the card root also carries the radiant ceremony skin (owner pick, round3-radiant)', () => {
    const html = render()
    const root_class = html.match(/<div class="(result[^"]*)"/)?.[1]
    expect(root_class?.split(' ')).toContain('radiant')
  })

  test('the mount effect never arms a dismiss timer (source contract — see file header for why SSR cannot prove this by execution)', () => {
    const source = readFileSync(new URL('./LevelUp.jsx', import.meta.url), 'utf8')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('AUTO_DISMISS')
  })

  test('dismiss is reachable only through the explicit action/level_up/close dispatch (Allocate/Later), never a bare timer callback', () => {
    const source = readFileSync(new URL('./LevelUp.jsx', import.meta.url), 'utf8')
    const dispatch_close_sites = source.match(/context\.dispatch\('action\/level_up\/close'\)/g) ?? []
    // exactly the two explicit CTAs (`dismiss`, folded into `allocate`) — never a THIRD site (a timer/effect).
    expect(dispatch_close_sites).toHaveLength(1)
  })
})

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})
