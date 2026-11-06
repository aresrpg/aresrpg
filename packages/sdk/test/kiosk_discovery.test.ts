// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { KioskOwnerCap } from '@mysten/kiosk'

import { read_personal_kiosks } from '../src/kiosk_discovery.ts'

const cap = (id: string, is_personal = true) =>
  ({ objectId: id, kioskId: id, isPersonal: is_personal, version: '1', digest: '' }) satisfies KioskOwnerCap

test('complete personal custody includes a requested kiosk beyond the first ownership page', async () => {
  const calls: (string | null | undefined)[] = []
  const sdk = {
    get_owned_kiosks: async (_owner: string, pagination?: { cursor?: string | null }) => {
      calls.push(pagination?.cursor)
      return pagination?.cursor
        ? { kioskOwnerCaps: [cap('later')], hasNextPage: false, nextCursor: null, kioskIds: [] }
        : {
            kioskOwnerCaps: [cap('first'), cap('ordinary', false)],
            hasNextPage: true,
            nextCursor: 'second',
            kioskIds: [],
          }
    },
  }
  const result = await read_personal_kiosks(sdk, 'owner')
  expect(result.map((row) => row.kioskId)).toEqual(['first', 'later'])
  expect(calls).toEqual([undefined, 'second'])
})
test('incomplete or cyclic ownership pagination never yields a partial roster', async () => {
  for (const next_cursor of [null, 'same']) {
    const sdk = {
      get_owned_kiosks: async () => ({
        kioskOwnerCaps: [cap('first')],
        hasNextPage: true,
        nextCursor: next_cursor,
        kioskIds: [],
      }),
    }
    await expect(read_personal_kiosks(sdk, 'owner')).rejects.toThrow('pagination')
  }
})
