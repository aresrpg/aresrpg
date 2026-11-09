// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentKioskCharacters } from '../../src/agents/AgentKioskCharacters.tsx'
import type { AgentKioskController } from '../../src/agents/useAgentKiosk.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'

const copy = {
  ui: {
    agent_transfer_character: 'Characters',
    agent_claim_character: 'Claim character for bot',
    agent_cancel_handover: 'Cancel handover',
  },
} as unknown as AppCopy
const controller = (deposit: object | null) =>
  ({
    wallet: { address: 'owner' },
    snapshot: {
      deposit,
      characters: [],
      recall: {
        characters: [],
        pending: [
          {
            character_id: 'character',
            purchase_cap: 'cap',
            seller_kiosk: 'owner-kiosk',
            recipient: 'bot',
            agent_address: 'owner',
          },
        ],
      },
    },
    execute: () => {
      throw new Error('Rendering must never initiate a transfer')
    },
  }) as unknown as AgentKioskController

test('pending owner handover offers an explicit enabled bot claim only with fresh deposit authority', () => {
  const html = renderToStaticMarkup(<AgentKioskCharacters kiosk={controller({})} copy={copy} disabled={false} />)
  expect(html).toContain('Claim character for bot')
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Claim character for bot/)
  expect(html).toContain('Cancel handover')
})
test('saved recovery and disabled states cannot claim a new character deposit', () => {
  for (const [deposit, disabled] of [
    [null, false],
    [{}, true],
  ] as const) {
    const html = renderToStaticMarkup(
      <AgentKioskCharacters kiosk={controller(deposit)} copy={copy} disabled={disabled} />
    )
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Claim character for bot/)
    expect(html).toContain('Cancel handover')
  }
})
