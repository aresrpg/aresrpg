// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { decode_cli_result, giftcard_batches, parse_send_args, send_giftcards } from '../send_giftcards.mjs'

const id = (n) => `0x${n.toString(16).padStart(64, '0')}`
const sender = id(1)
const package_id = id(2)
const row = { id: id(3), recipient: id(4) }
const fixture = () => {
  const calls = []
  const run = (args) => {
    calls.push(args)
    if (args[0] === 'active-address') return sender
    if (args[0] === 'object')
      return { objType: `${package_id}::distribution::Giftcard`, owner: { AddressOwner: sender } }
    return { digest: 'receipt', effects: { status: { status: 'success' } } }
  }
  return { run, calls }
}

test('batch plan keeps NFT addresses verbatim, deduplicates vouchers, and bounds transactions', () => {
  expect(giftcard_batches([row])).toEqual([[row]])
  expect(() => giftcard_batches([row, row])).toThrow('repeats')
  expect(
    giftcard_batches(Array.from({ length: 101 }, (_, n) => ({ id: id(n + 10), recipient: id(4) }))).map(
      (batch) => batch.length
    )
  ).toEqual([100, 1])
  expect(() => parse_send_args(['--execute', '--network', 'mainnet', '--manifest', 'cards.json'])).toThrow('receipts')
})

test('default simulation never submits and does not need a journal', async () => {
  const { run, calls } = fixture()
  await send_giftcards({ batches: [[row]], package_id, execute: false, run })
  expect(calls.filter(([command]) => command === 'ptb')).toEqual([
    ['ptb', '--transfer-objects', `[@${row.id}]`, `@${row.recipient}`, '--dry-run'],
  ])
})

test('lost submission response leaves intent recorded and never retries', async () => {
  const { run } = fixture()
  const saved = []
  let submissions = 0
  await expect(
    send_giftcards({
      batches: [[row], [{ ...row, id: id(5) }]],
      package_id,
      execute: true,
      run: (args) => {
        if (args[0] === 'ptb' && !args.includes('--dry-run')) {
          submissions++
          throw new Error('response lost')
        }
        return run(args)
      },
      save: async (value) => {
        saved.push(value)
      },
    })
  ).rejects.toThrow('response lost')
  expect(submissions).toBe(1)
  expect(saved).toEqual([{ index: 0, status: 'submitting', sender, transfers: [row] }])
})

// Captured Sui CLI 2026-09-05: dry-run of 0x2::clock::timestamp_ms(0x6), testnet.
test('CLI simulation decoder fails closed when PTB renders a failure instead of JSON', () => {
  expect(decode_cli_result(['ptb', '--dry-run'], 'Dry run completed, execution status: success\n')).toEqual({
    effects: { status: { status: 'success' } },
  })
  expect(() => decode_cli_result(['ptb', '--dry-run'], 'Dry run completed, execution status: failure\n')).toThrow(
    'did not succeed'
  )
  expect(() => decode_cli_result(['ptb', '--dry-run'], '')).toThrow('did not succeed')
})
