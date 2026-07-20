// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import i18n from '../../i18n'

import { get_marketplace_policy, marketplace_buy_tx } from './marketplace_buy_sdk'

const POLICY_ID = '0xpolicy'
const RULES = { contents: [{ name: '0x1::royalty_rule::Rule' }] }

function fake_sdk({ object = { objectId: POLICY_ID, json: { rules: RULES } } } = {}) {
  const calls = []
  const tx = { kind: 'transaction' }
  return {
    calls,
    tx,
    sdk: {
      grpc_client: {
        core: {
          getObject: async (args) => {
            calls.push(['getObject', args])
            return { object }
          },
        },
      },
      marketplace_buy_item_ptb: (args) => {
        calls.push(['item', args])
        return tx
      },
      marketplace_buy_character_ptb: (args) => {
        calls.push(['character', args])
        return tx
      },
    },
  }
}

describe('marketplace SDK purchase adapter', () => {
  test('reads the live policy snapshot over gRPC', async () => {
    const fixture = fake_sdk()
    expect(await get_marketplace_policy(fixture.sdk, POLICY_ID)).toEqual({ id: POLICY_ID, rules: RULES })
    expect(fixture.calls[0]).toEqual(['getObject', { objectId: POLICY_ID, include: { json: true } }])
  })

  test('item buys delegate to the existing SDK builder with the buyer kiosk pair', async () => {
    const fixture = fake_sdk()
    const cap = { kioskId: '0xbuyer-kiosk', objectId: '0xbuyer-cap' }
    const tx = await marketplace_buy_tx({
      sdk: fixture.sdk,
      kind: 'item',
      policy_id: POLICY_ID,
      cap,
      asset_id: '0xitem',
      seller_kiosk_id: '0xseller-kiosk',
      price_mist: '4100000000',
    })

    expect(tx).toBe(fixture.tx)
    expect(fixture.calls[1]).toEqual([
      'item',
      {
        item_id: '0xitem',
        seller_kiosk_id: '0xseller-kiosk',
        price_mist: '4100000000',
        kiosk_id: '0xbuyer-kiosk',
        personal_kiosk_cap_id: '0xbuyer-cap',
        policy: { id: POLICY_ID, rules: RULES },
      },
    ])
  })

  test('character buys use the SDK character builder and preserve first-kiosk creation', async () => {
    const fixture = fake_sdk()
    await marketplace_buy_tx({
      sdk: fixture.sdk,
      kind: 'character',
      policy_id: POLICY_ID,
      cap: null,
      asset_id: '0xcharacter',
      seller_kiosk_id: '0xseller-kiosk',
      price_mist: 9n,
    })

    expect(fixture.calls[1][0]).toBe('character')
    expect(fixture.calls[1][1]).toMatchObject({
      character_id: '0xcharacter',
      kiosk_id: null,
      personal_kiosk_cap_id: null,
    })
  })

  test('refuses to build a money transaction when the policy rules are unavailable', async () => {
    const fixture = fake_sdk({ object: { objectId: POLICY_ID, json: {} } })
    try {
      await get_marketplace_policy(fixture.sdk, POLICY_ID)
      throw new Error('expected policy pre-flight to refuse')
    } catch (error) {
      expect(error.message).toBe(i18n.t('marketplace.chain.policy_unavailable'))
      expect(error.cause.message).toContain(POLICY_ID)
    }
  })
})
