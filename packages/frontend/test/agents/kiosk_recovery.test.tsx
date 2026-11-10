// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, spyOn } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AuthSession } from '../../src/auth.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import { saved_recovery_identities } from '../../src/agents/pairing_storage.ts'
import { read_kiosk_character_returns } from '../../src/agents/useAgentKiosk.ts'
import { EmptyEquipment } from '../../src/characters/EmptyEquipment.tsx'

const copy = {
  ui: { agent_kiosk: 'Agent kiosk', agent_connect_your: 'Connect your agent' },
  characters_page: { no_character: 'No character' },
} as unknown as AppCopy

test('unsupported pairing never crashes ordinary inventory recovery discovery', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const wallet = {
      read_agent_pairing_request: () => {
        throw new Error('INVALID_PAIRING_REQUEST')
      },
    } as unknown as AuthSession
    expect(saved_recovery_identities(wallet, null)).toEqual([])
    expect(saved_recovery_identities(null, null)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  } finally {
    warn.mockRestore()
  }
})

test('an empty owned roster retains the real agent inventory instead of requiring another character', () => {
  const html = renderToStaticMarkup(<EmptyEquipment copy={copy} />)
  expect(html).toContain('No character')
  expect(html).toContain('aria-label="Agent kiosk"')
  expect(html).toContain('Connect your agent')
  expect(html).not.toContain('Transfer review')
})

test('a damaged character return is isolated from the inventory and coin snapshot', async () => {
  const wallet = {
    read_agent_returns: async () => {
      throw new Error('Equipment capability missing')
    },
  } as unknown as AuthSession
  expect(await read_kiosk_character_returns(wallet, 'agent')).toEqual({
    characters: [],
    character_error: 'Equipment capability missing',
  })
})
