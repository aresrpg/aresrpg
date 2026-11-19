// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

import { initial_allocation, reduce_allocation } from '../../src/allocation/runtime.ts'
import { allocation_view } from '../../src/allocation/view.ts'
import type { AuthSession } from '../../src/auth.ts'

const wallet = { address: '0x1', identity: 'zklogin' } as AuthSession
const status: AllocationStatus = {
  wallets: [{ address: '0x1', label: '' }],
  awards: [{ address: '0x1', tier: 'veteran', source: 'reserved' }],
}
test('Google invalidation clears cards and rejects an earlier asynchronous result', () => {
  const connected = { ...initial_allocation(), session: wallet, status }
  const pending = reduce_allocation(connected, { type: 'request', task: { kind: 'load' } })
  const invalidated = reduce_allocation(pending, { type: 'invalidated', wallet })
  expect(invalidated.session).toBeNull()
  expect(invalidated.status).toBeNull()
  expect(
    reduce_allocation(invalidated, {
      type: 'result',
      sequence: pending.sequence,
      result: { session: wallet, status, error: null, share_intent_url: null },
    })
  ).toBe(invalidated)
})
test('login and signing are exclusive; logout clears private cards immediately', () => {
  const pending = reduce_allocation(initial_allocation(), { type: 'request', task: { kind: 'google' } })
  expect(reduce_allocation(pending, { type: 'request', task: { kind: 'verify', wallet } })).toBe(pending)
  expect(
    reduce_allocation(
      { ...initial_allocation(), session: wallet, status },
      { type: 'request', task: { kind: 'logout' } }
    ).status
  ).toBeNull()
})
test('totals deduplicate verified addresses', () => {
  const view = allocation_view({ ...status, wallets: [...status.wallets, ...status.wallets] })
  expect(view.spots).toBe(1)
  expect(view.sui).toBe(125)
})

test('verified wallets without awards stay in the portfolio but never produce cards', () => {
  const portfolio = { ...status, wallets: [...status.wallets, { address: '0x2', label: 'External' }] }
  const view = allocation_view(portfolio)
  expect(view.cards.map(({ wallet }) => wallet.address)).toEqual(['0x1'])
  expect(view.spots).toBe(1)
  expect(view.sui).toBe(125)
  expect(allocation_view({ ...portfolio, awards: [] }).cards).toEqual([])
  expect(allocation_view(null).loaded).toBe(false)
  expect(portfolio.wallets).toHaveLength(2)
})

test('sharing opens an X composer with the localized card link and prefilled text', async () => {
  const { share_intent } = await import('../../src/allocation/runtime.ts')
  const url = new URL(
    share_intent('https://example.test/api/allocation?action=preview&token=opaque&v=1', 'fr', 'Veteran · KARES & Blast')
  )
  expect(url.origin).toBe('https://x.com')
  expect(url.pathname).toBe('/intent/tweet')
  expect(url.searchParams.get('text')).toBe('Veteran · KARES & Blast')
  const preview = new URL(url.searchParams.get('url')!)
  expect(preview.searchParams.get('token')).toBe('opaque')
  expect(preview.searchParams.get('locale')).toBe('fr')
  const sharing = reduce_allocation(
    { ...initial_allocation(), share_intent_url: preview.href },
    {
      type: 'request',
      task: { kind: 'share', address: '0x1', locale: 'fr', text: 'Veteran' },
    }
  )
  expect(sharing.share_intent_url).toBeNull()
})

test('linking a Google game wallet signs the existing account challenge and releases only the temporary signer', async () => {
  const { link_game_wallet } = await import('../../src/allocation/runtime.ts')
  let released = 0
  const calls: string[] = []
  const signer = {
    address: 'game-wallet',
    wallet_name: 'Google',
    sign_personal_message: async (bytes: Uint8Array) => {
      expect(new TextDecoder().decode(bytes)).toBe('bound-to-current-account')
      return { signature: 'signed' }
    },
    dispose: () => {
      released += 1
    },
  } as unknown as AuthSession
  await link_game_wallet(
    async (request) => {
      calls.push(request.action)
      if (request.action === 'wallet_challenge')
        return { action: 'wallet_challenge', nonce: 'nonce', message: 'bound-to-current-account' }
      expect(request).toEqual({ action: 'wallet_verify', nonce: 'nonce', signature: 'signed' })
      return { action: 'wallet_verify' }
    },
    async () => signer
  )
  expect(calls).toEqual(['wallet_challenge', 'wallet_verify'])
  expect(released).toBe(1)
  await expect(
    link_game_wallet(
      async () => {
        throw new Error('refused')
      },
      async () => signer
    )
  ).rejects.toThrow('refused')
  expect(released).toBe(2)
})
