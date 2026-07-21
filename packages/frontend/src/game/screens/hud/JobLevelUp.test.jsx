// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #369 pair — JobLevelUp.jsx carried the SAME bug class as LevelUp.jsx: translucent ground + a
// timer-driven auto-dismiss. Same fix, same 3 contract assertions (see LevelUp.test.jsx for the full
// rationale on why the dismiss contract is pinned at the source-shape level rather than by execution — this
// repo's HUD tests are SSR-only, renderToStaticMarkup never runs `useEffect`, and adding jsdom/happy-dom to
// prove it by execution would be a new dependency this ticket doesn't need).
import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../../i18n/locales/en.json'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

reset_auth_mock()
const [game_store] = await Promise.all([import('../../store.js')])
// 'miner' — a real gathering job_id (also seeded by job_progression.test.js) so get_job/job_unlocks resolve
// through the real @aresrpg/sdk/jobs SSOT instead of a fabricated id.
const state = {
  job_level_up: { job_id: 'miner', level: 2, levels_gained: 1 },
  level_up: null,
  fight_result: null,
}
const spies = [spyOn(game_store, 'use_game_state').mockImplementation((selector) => selector(state))]

const { JobLevelUp } = await import('./JobLevelUp.jsx')

const render = () => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(JobLevelUp)))

describe('JobLevelUp — issue #369 pair: opaque ground + no auto-dismiss', () => {
  test('the card root carries the opaque .result--fe canon, not the translucent glass alone', () => {
    const html = render()
    expect(html).toContain('class="result result--tall result--fe"')
  })

  test('the mount effect never arms a dismiss timer (source contract)', () => {
    const source = readFileSync(new URL('./JobLevelUp.jsx', import.meta.url), 'utf8')
    expect(source).not.toContain('setTimeout')
    expect(source).not.toContain('AUTO_DISMISS')
  })

  test('dismiss is reachable only through the explicit action/job_level_up/close dispatch, never a bare timer callback', () => {
    const source = readFileSync(new URL('./JobLevelUp.jsx', import.meta.url), 'utf8')
    const dispatch_close_sites = source.match(/context\.dispatch\('action\/job_level_up\/close'\)/g) ?? []
    expect(dispatch_close_sites).toHaveLength(1)
  })
})

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})
