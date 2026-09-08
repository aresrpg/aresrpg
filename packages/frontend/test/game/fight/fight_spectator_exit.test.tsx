// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightSpectatorExit, selected_spectator } from '../../../src/game/fight/FightSpectatorExit.tsx'
import type { AppCopy } from '../../../src/i18n/copy.ts'
import { initial_app_state, type AppState } from '../../../src/store.ts'

const copy = { fight_hud: { stop_spectating: 'Stop spectating' } } as unknown as AppCopy

test('the spectator exit accepts pointer input and is absent without a spectator', () => {
  const html = renderToStaticMarkup(<FightSpectatorExit character_id="0xa" copy={copy} />)
  expect(html).toContain('Stop spectating')
  expect(html).toContain('pointer-events-auto')
  expect(renderToStaticMarkup(<FightSpectatorExit character_id={null} copy={copy} />)).toBe('')
})

test('only the selected spectator gets the exit, never a participant or simulator', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const state: AppState = {
    ...base,
    session: { ...base.session, selected_character_id: '0xa', wallet: { address: '0xme' } as never },
    fight: {
      ...base.fight,
      mode: 'remote',
      mounted: true,
      spectating_by_character: { '0xa': '0xf1' },
      checkpoint: { contract: { id: '0xf1', fighters: [] } } as never,
    },
  }
  expect(selected_spectator(state)).toBe('0xa')
  expect(selected_spectator({ ...state, session: { ...state.session, selected_character_id: '0xb' } })).toBeNull()
  expect(selected_spectator({ ...state, fight: { ...state.fight, mode: 'local' } })).toBeNull()
  const participant = {
    ...state,
    fight: {
      ...state.fight,
      checkpoint: {
        contract: {
          id: '0xf1',
          fighters: [{ kind: { type: 'player', character: '0xa', owner: '0xme' }, settled: false }],
        },
      } as never,
    },
  }
  expect(selected_spectator(participant)).toBeNull()
})
