// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { added_wallets } from '../../src/allocation/wallet_feedback.ts'

const original = { owner: 'google', addresses: ['google', 'first'] }
test('hydration, account changes, removals and repeated snapshots do not celebrate', () => {
  expect(added_wallets(null, original)).toEqual([])
  expect(added_wallets(original, { ...original, addresses: ['first', 'google'] })).toEqual([])
  expect(added_wallets(original, { ...original, addresses: ['google'] })).toEqual([])
  expect(added_wallets(original, { owner: 'other', addresses: ['other', 'new'] })).toEqual([])
})
test('only newly verified addresses celebrate, once per observed addition', () => {
  const verified = { ...original, addresses: [...original.addresses, 'second'] }
  expect(added_wallets(original, verified)).toEqual(['second'])
  expect(added_wallets(verified, { ...verified })).toEqual([])
  expect(added_wallets(verified, { ...verified, addresses: ['google', 'second', 'third'] })).toEqual(['third'])
})
