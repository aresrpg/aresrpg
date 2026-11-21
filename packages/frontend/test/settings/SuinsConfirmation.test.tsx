// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import * as store from '../../src/store.ts'
import { initial_suins_state } from '../../src/modules/suins.ts'
import { load_app_copy, copy_text } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { SuinsConfirmation } from '../../src/settings/SuinsConfirmation.tsx'

test('every locale renders the erasure warning, exact destinations, defaults and parent protection', async () => {
  const state = {
    ...store.read_app_state(),
    suins: {
      ...initial_suins_state(),
      request: {
        kind: 'set',
        stage: 'review',
        source: 'settings',
        name: 'parent.sui',
        pairing: null,
        review: {
          fingerprint: 'private-review',
          player_address: '0xplayer',
          agent_address: '0xagent',
          erased_names: ['aresrpg.parent.sui'],
          unchanged: false,
        },
      },
    },
  } as store.AppState
  const selected = spyOn(store, 'useAppStore').mockImplementation((selector) => selector(state))
  try {
    for (const { code } of LOCALES) {
      const copy = await load_app_copy(code)
      const t = copy_text(copy.settings_page)
      const markup = renderToStaticMarkup(<SuinsConfirmation copy={copy} />)
      expect(markup).toContain('role="dialog"')
      expect(markup).toContain('aresrpg.parent.sui')
      expect(markup).toContain('aresrpgagent.parent.sui')
      expect(markup).toContain('0xplayer')
      expect(markup).toContain('0xagent')
      expect(markup).not.toContain('private-review')
      // Regression (production, 2026-11-20): Cancel read a copy key that does not exist and rendered
      // as an empty button beside "Confirm change".
      expect(markup).toContain(`>${copy.ui.agent_cancel}</button>`)
      expect(markup).not.toMatch(/<button[^>]*><\/button>/)
      for (const key of [
        'suins_confirm_title',
        'suins_confirm_erase',
        'suins_confirm_player',
        'suins_confirm_agent',
        'suins_confirm_parent',
        'suins_confirm_apply',
        'suins_stale_review',
      ]) {
        expect(t(key)).not.toBe(key)
        expect(t(key).length).toBeGreaterThan(0)
      }
    }
  } finally {
    selected.mockRestore()
  }
})
