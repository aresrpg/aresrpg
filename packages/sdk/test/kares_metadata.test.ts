// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { SDK } from '../src/client.ts'
import { kares_pins } from '../src/kares_ptb.ts'
import { update_kares_metadata_into } from '../src/kares_metadata.ts'

import { digest, fake_client, id, signer } from './helpers/transport.ts'

const pins = {
  kares_package: id(101),
  kares_package_original: id(100),
  kares_currency: { id: id(102), shared_version: '2' },
  kares_offering: { id: id(103), shared_version: '3' },
  kares_staking_pool: { id: id(104), shared_version: '3' },
  kares_combat_pot: { id: id(105), shared_version: '3' },
}

test('metadata composition exposes only native presentation setters with the original KARES identity', () => {
  const sdk = SDK({ client: fake_client({ simulate_ok: true }), pins, signer, transaction_storage: null })
  sdk.cache.owned.set(id(105), { objectId: id(105), version: '1', digest })
  const tx = new Transaction()
  update_kares_metadata_into(tx, sdk, kares_pins(pins), id(105), {
    name: 'AresRPG KARES',
    description: 'Community and Mastery rewards',
    icon_url: 'https://launchpad.aresrpg.world/kares.png',
  })
  const calls = tx.getData().commands.map((command) => command.MoveCall!)
  expect(calls.map((call) => call.function)).toEqual(['set_name', 'set_description', 'set_icon_url'])
  expect(calls.every((call) => call.package === id(2) && call.module === 'coin_registry')).toBe(true)
  expect(calls.every((call) => call.typeArguments[0] === `${id(100)}::kares::KARES`)).toBe(true)
  expect(() =>
    update_kares_metadata_into(new Transaction(), sdk, kares_pins(pins), id(105), {
      name: 'KARES',
      description: '',
      icon_url: 'javascript:alert(1)',
    })
  ).toThrow('HTTPS')
})
