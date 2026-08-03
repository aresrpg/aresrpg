// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import * as fight_sync_badge from './FightSyncBadge.jsx'

const { FightSyncBadge } = fight_sync_badge

test('fight receipt sync indicator is a small live status, not an interactive dead end', () => {
  const html = renderToStaticMarkup(<FightSyncBadge label="Loading..." />)
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-live="polite"')
  expect(html).toContain('Loading...')
  expect(html).toContain('animate-pulse')
})

test('an absent or unknown active actor is a resolving state, never an interactive turn', () => {
  // #1993 carve-out — the VERDICT moved to its one home (`fight_visible_view(state).sync.actor_unresolved`,
  // pinned verbatim against a real fight state in packages/fight/test/fight_visible_view.test.js). This module
  // no longer answers it, so what it owes is the chip's render contract for the answer it is handed.
  expect(fight_sync_badge.fight_actor_unresolved).toBeUndefined()

  const html = renderToStaticMarkup(<FightSyncBadge label="Waiting..." resolving />)
  expect(html).toContain('data-fight-resolving="true"')
  expect(html).toContain('toast-spinner')
})
