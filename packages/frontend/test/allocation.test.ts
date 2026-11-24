// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The allocation campaign's private account: its requests ride the real server link only once the server admitted the
// address, a lost or stolen link fails them without replaying a write, and a wallet links only by signing the
// account's own challenge. Its state never keeps a card or an answer that belongs to an earlier session.
import { afterAll, expect, jest, test } from 'bun:test'
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

import { create_allocation_client } from '../src/allocation/client.ts'
import { restore_allocation_wallet } from '../src/allocation/restoration.ts'
import { initial_allocation, link_game_wallet, reduce_allocation } from '../src/allocation/runtime.ts'
import type { AuthSession } from '../src/auth.ts'

import { fake_wallet, install_browser, last_socket, restore_globals } from './harness.ts'

afterAll(restore_globals)

const admitted = (address: string) => ({ type: 'packet/connection_accepted', stage: 'signed', address })

test('private campaign requests wait for admission, correlate replies, and a lost or replaced link never replays a write', async () => {
  install_browser('https://aresrpg.world/allocation')
  const wallet = fake_wallet()
  const client = create_allocation_client(wallet)
  const socket = last_socket()
  expect(socket.url.searchParams.get('address')).toBe(wallet.address)
  const share = client.request({ action: 'share', address: wallet.address })
  expect(socket.sent).toEqual([])
  socket.deliver(admitted(wallet.address))
  await Promise.resolve()
  const [request] = socket.sent.filter(({ type }) => type === 'packet/allocation_request')
  expect(request).toMatchObject({ request: { action: 'share', address: wallet.address } })
  socket.deliver({
    type: 'packet/allocation_response',
    id: (request as { id: number }).id,
    result: { action: 'share', url: 'https://example.test/link' },
  })
  expect(await share).toEqual({ action: 'share', url: 'https://example.test/link' })
  // Another tab took the seat: a request fails at once; only an explicit reconnect admits again, with a fresh link.
  socket.drop(1000, 'REPLACED')
  expect(await client.request({ action: 'status' }).catch((error: Error) => error.message)).toBe('connection_replaced')
  client.reconnect()
  const status = client.request({ action: 'status' })
  const fresh = last_socket()
  fresh.deliver(admitted(wallet.address))
  await Promise.resolve()
  const requests = () => fresh.sent.filter(({ type }) => type === 'packet/allocation_request') as { id: number }[]
  fresh.deliver({
    type: 'packet/allocation_response',
    id: requests()[0]!.id,
    result: { action: 'error', error: 'closed' },
  })
  await expect(status).rejects.toThrow('closed')
  // A write in flight when the link drops is refused, and the next admission does not send it again.
  const removal = client
    .request({ action: 'wallet_remove', address: wallet.address })
    .catch((error: Error) => error.message)
  await Promise.resolve()
  expect(requests()).toHaveLength(2)
  jest.useFakeTimers()
  try {
    fresh.drop(1006, 'lost')
    jest.advanceTimersByTime(1_000)
  } finally {
    jest.useRealTimers()
  }
  expect(await removal).toBe('connection_failed')
  const again = last_socket()
  expect(again).not.toBe(fresh)
  again.deliver(admitted(wallet.address))
  await Promise.resolve()
  expect(again.sent.filter(({ type }) => type === 'packet/allocation_request')).toEqual([])
  client.dispose()
  expect(again.closed).toEqual({ code: 1000, reason: 'CLIENT_CLOSED' })
})

test('the campaign account forgets a closed session, signs only its own challenge, and drops a late restored signer', async () => {
  const wallet = { address: '0x1', identity: 'zklogin' } as AuthSession
  const status: AllocationStatus = {
    wallets: [{ address: '0x1', label: '' }],
    awards: [{ address: '0x1', tier: 'veteran', source: 'reserved' }],
  }
  // A Google invalidation clears the private cards, and an answer to the earlier session is refused.
  const pending = reduce_allocation(
    { ...initial_allocation(), session: wallet, status },
    { type: 'request', task: { kind: 'load' } }
  )
  const invalidated = reduce_allocation(pending, { type: 'invalidated', wallet })
  expect(invalidated).toMatchObject({ session: null, status: null })
  const late = {
    type: 'result',
    sequence: pending.sequence,
    result: { session: wallet, status, error: null, share_intent_url: null },
  } as const
  expect(reduce_allocation(invalidated, late)).toBe(invalidated)
  // A sign-in and a signature never run together; logging out clears the cards at once.
  const signing_in = reduce_allocation(initial_allocation(), { type: 'request', task: { kind: 'google' } })
  expect(reduce_allocation(signing_in, { type: 'request', task: { kind: 'verify', wallet } })).toBe(signing_in)
  expect(
    reduce_allocation(
      { ...initial_allocation(), session: wallet, status },
      { type: 'request', task: { kind: 'logout' } }
    ).status
  ).toBeNull()
  // Linking the game wallet signs the bytes of the current account's challenge, then releases the temporary signer.
  const released: string[] = []
  const signer = fake_wallet({
    sign_personal_message: async (bytes: Uint8Array) => {
      expect(new TextDecoder().decode(bytes)).toBe('bound-to-current-account')
      return { signature: 'signed' }
    },
    dispose: () => void released.push('signer'),
  })
  const actions: string[] = []
  await link_game_wallet(
    async (request) => {
      actions.push(request.action)
      if (request.action === 'wallet_challenge')
        return { action: 'wallet_challenge', nonce: 'nonce', message: 'bound-to-current-account' }
      expect(request).toEqual({ action: 'wallet_verify', nonce: 'nonce', signature: 'signed' })
      return { action: 'wallet_verify' }
    },
    async () => signer
  )
  expect(actions).toEqual(['wallet_challenge', 'wallet_verify'])
  await expect(
    link_game_wallet(
      async () => Promise.reject(new Error('refused')),
      async () => signer
    )
  ).rejects.toThrow('refused')
  expect(released).toEqual(['signer', 'signer'])
  // A silent restore that answers after its deadline is disposed instead of entering a newer login.
  const slow = Promise.withResolvers<AuthSession | null>()
  await expect(restore_allocation_wallet(() => slow.promise, 1)).rejects.toThrow('restore_timeout')
  const disposed: string[] = []
  slow.resolve(fake_wallet({ dispose: () => void disposed.push('late') }))
  await Bun.sleep(0)
  expect(disposed).toEqual(['late'])
  expect(await restore_allocation_wallet(async () => wallet, 50)).toBe(wallet)
})
