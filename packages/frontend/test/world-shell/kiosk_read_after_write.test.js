// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROW #1664 RED: a confirmed mint must make create→join independent of a lagging kiosk census. The receipt
// enters the roster reducer first; join reads that reducer-owned fact and performs zero read-layer calls.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { project_character_mint } from '../../src/roster/mint_receipt'
import { character_join_handle, join_kiosk_for_character } from '../../src/world-shell/kiosk_resolve.js'

const CHARACTER = '0xfresh'
const KIOSK = '0xkiosk'
const CAP = '0xcap'
const ADDRESS = '0xowner'
const draft = {
  name: 'FreshHero',
  classe: 'senshi',
  male: true,
  color_1: 1,
  color_2: 2,
  color_3: 3,
}

const receipt = {
  objectChanges: [
    { type: 'created', objectId: CHARACTER, objectType: '0xares::character::Character' },
    { type: 'created', objectId: KIOSK, objectType: '0x2::kiosk::Kiosk' },
    {
      type: 'created',
      objectId: CAP,
      objectType: '0xpersonal::personal_kiosk::PersonalKioskCap',
    },
  ],
}

const base = () => ({
  characters: [],
  items: [],
  minted_character_floor: {},
  settled_item_floor: {},
  xp_floor: {},
  deleted_ids: {},
})

describe('row #1664 — join immediately after create with a lagging read layer', () => {
  test('the join refusal uses the complete localized kiosk explanation', () => {
    const source = readFileSync(new URL('../../src/world-shell/world_join.js', import.meta.url), 'utf8')
    expect(source).toContain("i18n.t('characters.delete.not_in_kiosk')")
    expect(source).not.toContain("new Error('That character is not in one of your kiosks')")
  })

  test('the mint receipt folds the kiosk pair through action/sui_data and join performs zero cold reads', async () => {
    const projection = project_character_mint(receipt, draft)
    const minted = reduce_sui_data(base(), projection.roster_input)
    const lagged = reduce_sui_data(minted, { kind: 'snapshot', characters: [] })
    const known_handle = character_join_handle(lagged.characters, CHARACTER)
    let reads = 0
    const sdk = {
      kiosk_client: {
        getOwnedKiosks: async () => {
          reads += 1
          return { kioskOwnerCaps: [] }
        },
      },
      grpc_client: {
        core: {
          getObject: async () => {
            reads += 1
            return { object: null }
          },
        },
      },
    }

    expect(known_handle).toEqual({ kiosk_id: KIOSK, personal_kiosk_cap_id: CAP })
    await expect(
      join_kiosk_for_character(sdk, ADDRESS, CHARACTER, {
        known_handle,
        sleep: async () => {},
      })
    ).resolves.toEqual(known_handle)
    expect(reads).toBe(0)
  })

  test('the lagging snapshot cannot erase the receipt row; the matching read row reconciles it', () => {
    const projection = project_character_mint(receipt, draft)
    const minted = reduce_sui_data(base(), projection.roster_input)
    const lagged = reduce_sui_data(minted, { kind: 'snapshot', characters: [] })
    expect(lagged.characters.map((row) => row.id)).toEqual([CHARACTER])
    expect(lagged.minted_character_floor).toHaveProperty(CHARACTER)

    const caught_up = reduce_sui_data(lagged, {
      kind: 'snapshot',
      characters: [{ id: CHARACTER, kiosk_id: KIOSK }],
    })
    expect(caught_up.minted_character_floor).toEqual({})
    expect(character_join_handle(caught_up.characters, CHARACTER)).toEqual({
      kiosk_id: KIOSK,
      personal_kiosk_cap_id: CAP,
    })
  })
})
