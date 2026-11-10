// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'
import type { AgentTransferActions } from '@aresrpg/sdk/agent-transfer-actions'

import type { AuthSession } from '../../src/auth.ts'
import { character_send_current, character_send_eligible } from '../../src/agents/character_send.ts'
import { execute_agent_transfer } from '../../src/agents/agent_transaction.ts'
import { create_single_flight } from '../../src/transaction_guard.ts'
import { automation_fixture, character } from '../modules/automation_fixture.ts'

const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const identity = create_agent_identity({
  agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(3)),
  zklogin_public_identifier: google,
})
const pairing = {
  address: identity.address,
  multisig_public_key: identity.public_key.toBase64(),
  signer_mode: 'host-persistent' as const,
}
const wallet = {
  address: google.toSuiAddress(),
  read_agent_pairing_request: (nonce: string) => ({
    version: 1,
    nonce,
    network: 'mainnet',
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }),
} as AuthSession
const clicked: CharacterRow = { ...character(), id: 'clicked-second', kiosk: 'clicked-kiosk', equipment: [] }
const session = () => ({
  ...automation_fixture().session,
  wallet,
  inventory_pairing: pairing,
  characters: [{ ...clicked, id: 'first' }, clicked],
  selected_character_id: 'first',
})

test('send binds clicked character rather than first or selected, and requires explicit persistent target', () => {
  const current = session()
  expect(character_send_current(current, wallet, pairing, clicked)).toBe(true)
  expect(
    character_send_current(
      { ...current, inventory_pairing: null, agent_pairing_candidate: pairing },
      wallet,
      pairing,
      clicked
    )
  ).toBe(false)
  expect(character_send_current(current, { ...wallet }, pairing, clicked)).toBe(false)
  expect(character_send_current(current, wallet, { ...pairing, signer_mode: 'disposable' }, clicked)).toBe(false)
  expect(character_send_current({ ...current, characters: [current.characters[0]!] }, wallet, pairing, clicked)).toBe(
    false
  )
  expect(character_send_eligible({ ...clicked, custody: 'fight' })).toBe(false)
  expect(character_send_eligible(character())).toBe(true)
})

for (const change of ['wallet', 'target', 'custody', 'equipment', 'kiosk', 'removed'] as const) {
  test(`${change} change during prepare prevents character confirmation`, async () => {
    let current = session()
    let confirmed = false
    const actions = {
      prepare: async () => {
        if (change === 'wallet') current = { ...current, wallet: { ...wallet } }
        if (change === 'target') current = { ...current, inventory_pairing: { ...pairing, address: 'other' } }
        if (change === 'custody') current = { ...current, characters: [{ ...clicked, custody: 'fight' }] }
        if (change === 'equipment')
          current = { ...current, characters: [{ ...clicked, equipment: character().equipment }] }
        if (change === 'kiosk') current = { ...current, characters: [{ ...clicked, kiosk: 'other' }] }
        if (change === 'removed') current = { ...current, characters: [] }
        return {
          confirm: async () => {
            confirmed = true
            return { digest: 'never' }
          },
        }
      },
    } as unknown as AgentTransferActions
    await expect(
      execute_agent_transfer({
        actions,
        intent: { kind: 'offer', character_id: clicked.id, kiosk: clicked.kiosk, recipient: pairing.address },
        is_current: () => character_send_current(current, wallet, pairing, clicked),
      })
    ).rejects.toThrow()
    expect(confirmed).toBe(false)
  })
}

test('duplicate gestures cannot prepare a second character offer', async () => {
  const run = create_single_flight()
  let calls = 0
  const action = async () => {
    calls += 1
    return { digest: 'one' }
  }
  const first = run(action)
  expect(run(action)).toBeNull()
  await first
  expect(calls).toBe(1)
})

test('context menu retains the clicked row and sends without a second technical modal', async () => {
  const tabs = await Bun.file(new URL('../../src/components/CharacterTabs.tsx', import.meta.url)).text()
  expect(tabs).not.toContain('data-character-actions')
  expect(tabs).toContain('set_menu({ character_id: character.id, x: event.clientX, y: event.clientY })')
  expect(tabs).toContain('character_id={menu.character_id}')
  expect(tabs).toContain('send_character_to_agent(character_id, copy)')
  expect(tabs).not.toContain('AgentCharacterSend')
})
