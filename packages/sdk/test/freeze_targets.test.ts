// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { Sdk } from '../src/client.ts'
import { verify_upgrade_cap_targets } from '../src/seed_admin.ts'

import { id } from './helpers/transport.ts'

test('the final freeze verifies all six pinned lineages, including rewards', async () => {
  const prefixes = ['math_', 'control_', 'combat_', 'seed_', 'kares_rewards_', '']
  const caps = prefixes.map((_, index) => id(20 + index))
  const packages = prefixes.map((_, index) => id(30 + index))
  const pins = Object.fromEntries(
    prefixes.flatMap((prefix, index) => [
      [`${prefix}upgrade_cap`, caps[index]],
      [`${prefix}package`, packages[index]],
    ])
  )
  const sdk = {
    pins,
    sui_client: {
      core: {
        getObjects: async () => ({
          objects: caps.map((object_id, index) => ({ objectId: object_id, json: { package: packages[index] } })),
        }),
      },
    },
  } as unknown as Sdk
  expect(await verify_upgrade_cap_targets(sdk)).toEqual(caps)
  await expect(
    verify_upgrade_cap_targets({ ...sdk, pins: { ...pins, kares_rewards_package: id(40) } })
  ).rejects.toThrow('does not control active package')
  await expect(
    verify_upgrade_cap_targets({ ...sdk, pins: { ...pins, kares_rewards_upgrade_cap: caps[0] } })
  ).rejects.toThrow('six distinct')
  await expect(
    verify_upgrade_cap_targets({ ...sdk, pins: { ...pins, kares_rewards_upgrade_cap: undefined } })
  ).rejects.toThrow('kares_rewards_UpgradeCap')
})
