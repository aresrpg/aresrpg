// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import sharp from 'sharp'
import { ZkSendLinkBuilder } from '@mysten/zksend'

import { assert_custody, claim_url, parse_export_args, render_giftcard } from './export_giftcards.mjs'

test('giftcard export requires an explicit state-changing flag', () => {
  expect(() =>
    parse_export_args(['--claim-origin', 'https://aresrpg.world', '--output', 'giftcard-exports/test'])
  ).toThrow(/--execute is required/u)
})

test('printed QR stays on AresRPG and keeps the zkSend secret in the fragment', () => {
  expect(claim_url('https://aresrpg.world', 'https://api.slush.app/claim?network=testnet#$secret')).toBe(
    'https://aresrpg.world/gift?network=testnet#$secret'
  )
})

test('giftcard custody must be controlled by the export signer, never a Publisher object', () => {
  const signer_address = `0x${'3'.repeat(64)}`
  const publisher_object = `0x${'5'.repeat(64)}`
  const signer = { toSuiAddress: () => signer_address }

  expect(() => assert_custody(signer, [{ custody: publisher_object }])).toThrow(/does not control/u)
  expect(assert_custody(signer, [{ custody: signer_address }])).toBe(signer_address)
})

test('giftcard renderer produces one 300 DPI print card', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'aresrpg-giftcard-'))
  const output = resolve(folder, '001.png')
  await render_giftcard({
    url: 'https://aresrpg.world/gift#$test-secret',
    serial: 1,
    count: 100,
    icon: resolve(import.meta.dir, '../seed/icons/items/sui_crate_hd.png'),
    output,
  })

  await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 1_004, height: 650, density: 300 })
})

test('one hundred links remain one atomic transaction below the command ceiling', async () => {
  const sender = `0x${'1'.repeat(64)}`
  const object_ids = Array.from({ length: 100 }, (_, index) => `0x${String(index + 2).padStart(64, '0')}`)
  const client = {
    network: 'testnet',
    core: {
      getObjects: async ({ objectIds }) => ({
        objects: objectIds.map((object_id) => ({
          objectId: object_id,
          version: '1',
          digest: '11111111111111111111111111111111',
          type: `0x${'2'.repeat(64)}::distribution::Giftcard`,
        })),
      }),
    },
  }
  const links = object_ids.map((object_id) => {
    const link = new ZkSendLinkBuilder({ client, network: 'testnet', sender })
    link.addClaimableObject(object_id)
    return link
  })

  const transaction = await ZkSendLinkBuilder.createLinks({ client, network: 'testnet', links })

  expect(transaction.getData().commands).toHaveLength(200)
})
