// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1127: the settled Character object re-enters roster state as one typed reducer input.

import { describe, expect, test } from 'bun:test'

import { mint_session_matches, project_character_mint } from '../../src/roster/mint_receipt'
import { EXPEDITION_INITIAL_STATE, reduce_expedition } from '../../src/roster/store_reducer'

const draft = {
  name: 'ReceiptHero',
  classe: 'senshi',
  male: false,
  color_1: 0x112233,
  color_2: 0x445566,
  color_3: 0x778899,
}

describe('project_character_mint', () => {
  test('rejects a receipt continuation after the wallet session changes', () => {
    expect(mint_session_matches('0xaccount-a', '0xaccount-b')).toBe(false)
    expect(mint_session_matches('0xaccount-a', '0xaccount-a')).toBe(true)
  })

  test('projects the exact created Character and kiosk pair into one reducer input', () => {
    const projection = project_character_mint(
      {
        objectChanges: [
          {
            type: 'mutated',
            objectId: '0xignored',
            objectType: '0xares::character::Character',
          },
          {
            type: 'created',
            objectId: '0xcharacter',
            objectType: '0xares::character::Character',
          },
          {
            type: 'created',
            objectId: '0xkiosk',
            objectType: '0x2::kiosk::Kiosk',
          },
          {
            type: 'created',
            objectId: '0xcap',
            objectType: '0xpersonal::personal_kiosk::PersonalKioskCap',
          },
        ],
      },
      draft
    )

    expect(projection).not.toBeNull()
    expect(projection?.character).toMatchObject({
      id: '0xcharacter',
      _type: '0xares::character::Character',
      name: 'ReceiptHero',
      classe: 'senshi',
      sex: 'female',
      male: false,
      color_1: 0x112233,
      color_2: 0x445566,
      color_3: 0x778899,
      experience: 0,
      health: 100,
    })
    expect(projection?.kiosk_id).toBe('0xkiosk')
    expect(projection?.personal_kiosk_cap_id).toBe('0xcap')
    expect(projection?.roster_input).toEqual({
      kind: 'receipt_patch',
      op: 'mint_character',
      row: projection?.character,
    })
    expect(projection?.roster_input.row).toBe(projection?.character)
  })

  test('refuses to fabricate a row when the receipt contains no created Character', () => {
    expect(
      project_character_mint(
        {
          objectChanges: [
            {
              type: 'created',
              objectId: '0xkiosk',
              objectType: '0x2::kiosk::Kiosk',
            },
          ],
        },
        draft
      )
    ).toBeNull()
  })
})

describe('Character mint completion re-enters the expedition store through its reducer input', () => {
  test('started, settled, and finished transitions fold against the latest state', () => {
    const prior = {
      ...EXPEDITION_INITIAL_STATE,
      kiosk_id: '0xprior-kiosk',
      personal_kiosk_cap_id: '0xprior-cap',
    }
    const started = reduce_expedition(prior, { type: 'character_mint/started' })
    expect(started.busy).toBe(true)

    const character = { id: '0xcharacter', name: 'ReceiptHero' }
    const settled = reduce_expedition(started, {
      type: 'character_mint/settled',
      character,
      kiosk_id: null,
      personal_kiosk_cap_id: null,
    })
    expect(settled).toMatchObject({
      busy: false,
      character,
      kiosk_id: '0xprior-kiosk',
      personal_kiosk_cap_id: '0xprior-cap',
    })

    const paid_started = reduce_expedition(settled, { type: 'character_mint/started' })
    const paid_finished = reduce_expedition(paid_started, { type: 'character_mint/finished' })
    expect(paid_finished.busy).toBe(false)
    expect(paid_finished.character).toBe(character)
  })

  test('the async character/read refresh results use the same reducer door', () => {
    const loading = reduce_expedition(EXPEDITION_INITIAL_STATE, { type: 'character_load/started' })
    expect(loading.loading).toBe(true)

    const character = { id: '0xcharacter' }
    const loaded = reduce_expedition(loading, {
      type: 'character_load/settled',
      kiosk_id: '0xkiosk',
      personal_kiosk_cap_id: '0xcap',
      character,
      no_character: false,
      expedition_id: '0xexpedition',
    })
    expect(loaded).toMatchObject({
      loading: false,
      kiosk_id: '0xkiosk',
      personal_kiosk_cap_id: '0xcap',
      character,
      no_character: false,
      expedition_id: '0xexpedition',
    })

    const expedition = { id: '0xexpedition', status: 0 }
    const refreshed = reduce_expedition(loaded, { type: 'expedition/refreshed', expedition })
    expect(refreshed.expedition).toBe(expedition)
    expect(reduce_expedition({ ...refreshed, loading: true }, { type: 'character_load/failed' }).loading).toBe(false)
  })
})
