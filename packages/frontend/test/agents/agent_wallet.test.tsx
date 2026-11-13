// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { agent_wallet_current } from '../../src/agents/agent_wallet.ts'
import { AgentWalletBalance } from '../../src/agents/AgentWalletCard.tsx'
import { automation_fixture } from '../modules/automation_fixture.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'

const watching = () => {
  const { session } = automation_fixture()
  const pairing = { address: 'agent', multisig_public_key: 'key', signer_mode: 'host-persistent' as const }
  return {
    ...session,
    inventory_pairing: pairing,
    agent_view: {
      ...session.agent_view,
      status: 'ready' as const,
      request: { pairing, public_identifier: 'google', character_id: session.selected_character_id! },
    },
  }
}
test('wallet authorization retires on disconnect, owner replacement, pairing or spectator changes', () => {
  const opened = watching()
  expect(agent_wallet_current(opened, opened)).toBe(true)
  const changes = [
    { ...opened, wallet: null },
    { ...opened, wallet: { ...opened.wallet! } },
    { ...opened, link_status: 'idle' as const },
    { ...opened, selected_character_id: 'other' },
    { ...opened, agent_view: { ...opened.agent_view, status: 'idle' as const, request: null } },
    { ...opened, agent_view: { ...opened.agent_view, serial: opened.agent_view.serial + 1 } },
    { ...opened, inventory_pairing: { ...opened.inventory_pairing, multisig_public_key: 'other' } },
    { ...opened, inventory_pairing: { ...opened.inventory_pairing, signer_mode: 'disposable' as const } },
  ]
  for (const changed of changes) expect(agent_wallet_current(opened, changed)).toBe(false)
})
test('agent wallet exposes the shared accessible Send and Add funds menu, disabled while offline', () => {
  const copy = {
    ui: { agent_wallet: 'Agent wallet' },
    wallet_send: 'Send',
    wallet_add_funds: 'Add funds',
    wallet_copy_address: 'Copy address',
  } as unknown as AppCopy
  const session = watching()
  const html = renderToStaticMarkup(<AgentWalletBalance copy={copy} session={session} />)
  expect(html).toContain('aria-haspopup="dialog"')
  expect(html).toContain('aria-label="Agent wallet"')
  expect(html).toContain('Send')
  expect(html).toContain('Add funds')
  expect(html).not.toContain('disabled=""')
  const offline = renderToStaticMarkup(<AgentWalletBalance copy={copy} session={{ ...session, link_status: 'idle' }} />)
  expect(offline.match(/disabled=""/g)).toHaveLength(2)
})
