// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE on-chain tx marker (mirrors packages/move/aresrpg/sources/header.move's no-op `aresrpg` entry fun):
// every fresh SDK-built PTB leads with this moveCall so explorers title the tx and the sponsor's per-user fee
// counter can filter "is this an aresrpg tx?" by its presence. Owner ruling 2026-07-24 — restored end-to-end
// after the S-57 domain-file migration silently dropped it from every builder but one marketplace buy path
// (items_marketplace.js, patched ad hoc). This is the ONE seam every write-flow builder's `tx` default now
// resolves through (see sui/write/header.js) — direct coverage of the shared helper itself.

import { test, expect } from 'bun:test'

import { new_ptb } from '../src/sui/write/header.js'

import { targets, find_call, IDS, EMPTY_IDS } from './_onchain_fixtures.js'

test('new_ptb opens a fresh tx whose ONLY command is the aresrpg no-op at the latest package id', () => {
  const tx = new_ptb('testnet', IDS.aresrpg)
  expect(targets(tx)).toEqual(['header::aresrpg'])
  const call = find_call(tx, 'header::aresrpg')
  expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
  expect(call.args).toBe(0)
})

test('new_ptb refuses loudly on an undeployed network — never invents an id', () => {
  expect(() => new_ptb('testnet', EMPTY_IDS.aresrpg)).toThrow(/not deployed/)
})

test('new_ptb resolves ids through the override seam per network (offline-buildable, no live publish)', () => {
  const mainnet_tx = new_ptb('mainnet', IDS.aresrpg)
  expect(find_call(mainnet_tx, 'header::aresrpg').package).toBe(
    IDS.aresrpg.LATEST_PACKAGE_ID,
  )
})
