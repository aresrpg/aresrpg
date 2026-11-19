// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { agent_connect_url, is_agent_entry } from '../../src/agents/entry_intent.ts'
import { env } from '../../src/env.ts'

test('the agent entry link uses the configured app URL', () => {
  expect(agent_connect_url()).toBe(new URL('/world?intent=connect-agent', env.app_url).href)
  expect(agent_connect_url('https://game.example/')).toBe('https://game.example/world?intent=connect-agent')
})

test('the entry link, a consent link and the old path all name the standalone agent page', () => {
  for (const location of [
    { pathname: '/world', search: '?intent=connect-agent' },
    { pathname: '/world', search: '?keep=one&intent=connect-agent&authorization_id=abc' },
    { pathname: '/connect-agent', search: '' },
    { pathname: '/connect-agent/', search: '' },
  ])
    expect(is_agent_entry(location)).toBe(true)
})

test('an ordinary game URL is never the agent page', () => {
  for (const location of [
    { pathname: '/world', search: '' },
    { pathname: '/world', search: '?intent=other' },
    { pathname: '/', search: '' },
    { pathname: '/kares', search: '' },
  ])
    expect(is_agent_entry(location)).toBe(false)
})
