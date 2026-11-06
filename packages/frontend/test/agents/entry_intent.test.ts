// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { agent_connect_url, consumed_agent_entry_url, is_agent_entry } from '../../src/agents/entry_intent.ts'
import { env } from '../../src/env.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

test('agent entry uses the configured app URL and preserves other URL fields when consumed', () => {
  expect(agent_connect_url()).toBe(new URL('/connect-agent?intent=connect-agent', env.app_url).href)
  expect(agent_connect_url('https://game.example/')).toBe('https://game.example/connect-agent?intent=connect-agent')
  expect(
    consumed_agent_entry_url({ pathname: '/', search: '?keep=one&intent=connect-agent&keep=two', hash: '#anchor' })
  ).toBe('/connect-agent?keep=one&keep=two#anchor')
  expect(consumed_agent_entry_url({ pathname: '/', search: '?intent=unknown', hash: '' })).toBeNull()
  expect(consumed_agent_entry_url({ pathname: '/', search: '', hash: '' })).toBeNull()
})

test('agent dialog requires a session and survives the first empty or repeated roster packet', () => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  expect(reduce_app_state(base, { type: 'dialog/open', dialog: 'agent_setup' })).toBe(base)
  const signed_in = { ...base, session: { ...base.session, wallet: { address: '0xfixture' } as never } }
  const opened = reduce_app_state(signed_in, { type: 'dialog/open', dialog: 'agent_setup' })
  const roster = { type: 'server/packet' as const, packet: { type: 'packet/characters' as const, characters: [] } }
  const first = reduce_app_state(opened, roster)
  expect(first.session.roster_loaded).toBe(true)
  expect(first.navigation.dialog).toBe('agent_setup')
  expect(reduce_app_state(first, roster).navigation.dialog).toBe('agent_setup')
  expect(reduce_app_state(first, { type: 'auth/disconnected' }).navigation.dialog).toBeNull()
})

test('the lightweight route survives reload and logout while the open-modal intent stays one-shot', () => {
  expect(is_agent_entry({ pathname: '/connect-agent', search: '' })).toBe(true)
  expect(is_agent_entry({ pathname: '/', search: '?intent=connect-agent' })).toBe(true)
  expect(is_agent_entry({ pathname: '/', search: '' })).toBe(false)
  expect(is_agent_entry({ pathname: '/practice', search: '' })).toBe(false)
  expect(consumed_agent_entry_url({ pathname: '/connect-agent', search: '', hash: '' })).toBeNull()
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const route = reduce_app_state(base, { type: 'route/changed', pathname: '/connect-agent' })
  expect(reduce_app_state(route, { type: 'auth/disconnected' }).navigation.pathname).toBe('/connect-agent')
})
