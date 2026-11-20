// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, mock, test } from 'bun:test'
import type { GiftPolicy } from '@aresrpg/sdk/gift-provenance'

import { create_gift_runtime } from '../../src/airdrop/gift_runtime.ts'
import type { GiftWallet } from '../../src/airdrop/gift_state.ts'

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

test('a used QR cannot silently display another gift from the current account', async () => {
  const status = mock(async () => ({ stage: 'collected' as const, proof: { giftcard: 'another-card' } }))
  const wallet = {
    address: 'alice',
    wallet_name: 'Google',
    identity: 'zklogin',
    inspect_giftcard_link: async () => null,
    read_sui_balance: async () => 1_000_000_000n,
    gift: () => ({ recover: async () => false, status }),
  } as unknown as GiftWallet
  const runtime = create_gift_runtime({
    link: 'https://aresrpg.world/gift#$used-card',
    policy: {} as GiftPolicy,
    storage: null,
    load_auth: async () => () => ({
      connect_google: async () => wallet,
      restore: async () => wallet,
      dispose: () => {},
    }),
  })
  const stop = runtime.observe()
  try {
    await settled()
    runtime.dispatch({ type: 'request', kind: 'login' })
    await settled()
    expect(status).not.toHaveBeenCalled()
    expect(runtime.store.getState().status?.stage).toBe('missing')
    runtime.dispatch({ type: 'check_account' })
    await settled()
    expect(status).toHaveBeenCalledTimes(1)
    expect(runtime.store.getState().status?.proof?.giftcard).toBe('another-card')
  } finally {
    stop()
  }
})
