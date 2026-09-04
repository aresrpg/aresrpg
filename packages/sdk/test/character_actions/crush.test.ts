// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KioskOwnerCap } from '@mysten/kiosk'
import { expect, test } from 'bun:test'

import type { Receipt } from '../../src/cache.ts'
import { character_actions } from '../../src/character_actions.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const kiosk_cap = Object.freeze({
  objectId: id(3),
  kioskId: id(12),
  isPersonal: true,
  version: '1',
  digest,
}) satisfies KioskOwnerCap

test('crush redemption explicitly refreshes its new claim before transaction resolution', async () => {
  const hydrated: string[][] = []
  const unknown: string[][] = []
  const sdk = {
    pins: { content_root: { id: id(61) }, seed_package_original: id(60) },
    tx: () => ({}),
    hydrate: async (ids: readonly string[]) => void hydrated.push([...ids]),
    hydrate_unknown: async (ids: readonly string[]) => void unknown.push([...ids]),
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
      compose(kiosk_cap.kioskId, {}),
    execute: async () =>
      ({ $kind: 'Transaction', Transaction: { digest, objectTypes: {}, effects: { changedObjects: [] } } }) as Receipt,
    doors: { redeem_rune: () => {}, discard_crush_claim: () => {} },
  }
  const claim_id = id(71)
  const actions = character_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

  await actions.redeem_crush({
    claim_id,
    runes: [{ item_type: 'rune_strength_ba', existing: null }],
    custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
  })

  expect(hydrated).toEqual([[claim_id]])
  expect(unknown).toHaveLength(1)
  expect(unknown[0]).not.toContain(claim_id)
})
