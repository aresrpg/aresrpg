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
  const fighters = new Map([['hero', { id: 'hero' }]])
  expect(fight_sync_badge.fight_actor_unresolved?.({ active_entity_id: null, fighters })).toBe(true)
  expect(fight_sync_badge.fight_actor_unresolved?.({ active_entity_id: 'missing', fighters })).toBe(true)
  expect(fight_sync_badge.fight_actor_unresolved?.({ active_entity_id: 'hero', fighters })).toBe(false)

  const html = renderToStaticMarkup(<FightSyncBadge label="Waiting..." resolving />)
  expect(html).toContain('data-fight-resolving="true"')
  expect(html).toContain('toast-spinner')
})
