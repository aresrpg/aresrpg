// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KioskOwnerCap } from '@mysten/kiosk'
import { expect, test } from 'bun:test'

import type { Receipt } from '../src/cache.ts'
import { character_actions } from '../src/character_actions.ts'
import { item_template_id } from '../src/seed_ids.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const reveal_digest = '11111111111111111111111111111111'
const redeem_digest = '22222222222222222222222222222222'
const claim_id = id(71)
const kiosk_cap = Object.freeze({
  objectId: id(3),
  kioskId: id(12),
  isPersonal: true,
  version: '1',
  digest: reveal_digest,
}) satisfies KioskOwnerCap

test('crush redemption reveals first and composes calls only for awarded rune types', async () => {
  const calls: Readonly<{ door: string; args: Readonly<Record<string, unknown>> }>[] = []
  const hydrated: string[][] = []
  const owed = Array.from({ length: 45 }, () => '0')
  owed[15] = '1' // agility Ba: stat index 5 × three tiers
  let execution = 0
  const sdk = {
    pins: { content_root: { id: id(61) }, seed_package_original: id(60) },
    tx: () => ({}),
    hydrate_unknown: async (ids: readonly string[]) => void hydrated.push([...ids]),
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
      compose(kiosk_cap.kioskId, {}),
    execute: async (): Promise<Receipt> => {
      execution += 1
      return execution === 1
        ? {
            $kind: 'Transaction',
            Transaction: {
              digest: reveal_digest,
              events: [{ type: `${id(1)}::forgemagie::CrushRevealed`, json: { claim: claim_id, owed } }],
            },
          }
        : { $kind: 'Transaction', Transaction: { digest: redeem_digest, effects: { changedObjects: [] } } }
    },
    doors: {
      reveal_crush_claim: (_tx: unknown, args: Record<string, unknown>) => void calls.push({ door: 'reveal', args }),
      redeem_rune: (_tx: unknown, args: Record<string, unknown>) => void calls.push({ door: 'redeem', args }),
      discard_crush_claim: (_tx: unknown, args: Record<string, unknown>) => void calls.push({ door: 'discard', args }),
    },
  }

  const result = await character_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).redeem_crush({
    claim_id,
    runes: [
      { item_type: 'rune_strength_ba', existing: id(80) },
      { item_type: 'rune_agility_ba', existing: null },
      { item_type: 'rune_vitality_ra', existing: id(81) },
    ],
    custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
  })

  expect(calls.map(({ door }) => door)).toEqual(['reveal', 'redeem', 'discard'])
  expect(calls[1]?.args).toMatchObject({
    claim: claim_id,
    template: item_template_id(id(61), id(60), 'rune_agility_ba'),
    stat: 5,
    tier: 1,
    existing: null,
  })
  expect(hydrated).toEqual([[item_template_id(id(61), id(60), 'rune_agility_ba')]])
  expect(result).toEqual({ digest: redeem_digest, item_ids: [] })
})

test('an already revealed empty crush remains closable without any rune calls', async () => {
  const calls: string[] = []
  let execution = 0
  const sdk = {
    pins: { content_root: { id: id(61) }, seed_package_original: id(60) },
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: () => {
      throw new Error('an empty claim must not resolve kiosk custody')
    },
    execute: async (): Promise<Receipt> => {
      execution += 1
      return execution === 1
        ? {
            $kind: 'Transaction',
            Transaction: {
              digest: reveal_digest,
              events: [
                {
                  type: `${id(1)}::forgemagie::CrushRevealed`,
                  json: { claim: claim_id, owed: Array.from({ length: 45 }, () => '0') },
                },
              ],
            },
          }
        : { $kind: 'Transaction', Transaction: { digest: redeem_digest, effects: { changedObjects: [] } } }
    },
    doors: {
      reveal_crush_claim: () => void calls.push('reveal'),
      redeem_rune: () => void calls.push('redeem'),
      discard_crush_claim: () => void calls.push('discard'),
    },
  }

  await character_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).redeem_crush({
    claim_id,
    runes: [{ item_type: 'rune_strength_ba', existing: null }],
  })

  expect(calls).toEqual(['reveal', 'discard'])
})
