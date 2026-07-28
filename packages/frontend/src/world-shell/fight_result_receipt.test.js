// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import {
  loot_from_minted_rows,
  loot_from_rolled,
  receipt_final_hp,
  receipt_minted_outcomes,
} from './fight_result_receipt.js'

const event = (name, parsedJson) => ({ type: `0xengine::fight_events::${name}`, parsedJson })
const decode = (row) => row?.parsedJson ?? null

describe('receipt_final_hp — correlate ResultMinted with the opened character', () => {
  it('selects my seat from a multiplayer atomic-settlement receipt', () => {
    const events = [
      event('ResultMinted', { character: '0xother', final_hp: '87' }),
      event('ResultMinted', { character: '0xmine', final_hp: '31' }),
      event('ResultOpened', { character: '0xmine', xp_share: '55' }),
    ]
    expect(receipt_final_hp(events, '0xmine', decode)).toBe(31)
  })

  it('returns null when ResultMinted is absent, never a fabricated zero', () => {
    expect(receipt_final_hp([event('ResultOpened', { character: '0xmine' })], '0xmine', decode)).toBeNull()
  })

  it('accepts an authoritative zero HP and rejects malformed HP', () => {
    expect(receipt_final_hp([event('ResultMinted', { character: '0xmine', final_hp: 0 })], '0xmine', decode)).toBe(0)
    expect(
      receipt_final_hp([event('ResultMinted', { character: '0xmine', final_hp: 'not-a-number' })], '0xmine', decode)
    ).toBeNull()
  })
})

describe('receipt_minted_outcomes — every same-wallet dungeon seat keeps its exact outcome id', () => {
  it('maps ResultMinted rows by character and ignores unrelated events', () => {
    const events = [
      event('TurnStarted', { character: 'leader', result: 'not-an-outcome' }),
      event('ResultMinted', { character: 'leader', result: 'outcome-leader' }),
      event('ResultMinted', { character: 'alt-a', result: 'outcome-a' }),
      event('ResultMinted', { character: 'alt-b', result: 'outcome-b' }),
    ]

    expect([...receipt_minted_outcomes(events, decode)]).toEqual([
      ['leader', 'outcome-leader'],
      ['alt-a', 'outcome-a'],
      ['alt-b', 'outcome-b'],
    ])
  })
})

describe('fight loot projection — live icon slugs are captured before FightReport renders (#1522)', () => {
  const template_id = `0x${'1522'.repeat(16)}`
  const live_templates = new Map([
    [
      template_id,
      {
        item_type: 'post_receipt_starfell_shard',
        name: 'Starfell Shard',
      },
    ],
  ])

  it('snapshots the live id → slug pair on an aggregate FightResult row', () => {
    expect(loot_from_rolled([{ item_template: template_id, qty: 2 }], live_templates)).toEqual([
      {
        template_id,
        item_type: 'post_receipt_starfell_shard',
        icon_slug: 'post_receipt_starfell_shard',
        name: 'Starfell Shard',
        amount: 2,
      },
    ])
  })

  it('keeps the live slug when exact ItemMinted rows replace the aggregate projection', () => {
    expect(
      loot_from_minted_rows([
        {
          id: '0xminted-item',
          template_id,
          item_type: 'resource',
          icon_slug: live_templates.get(template_id).item_type,
          name: 'Starfell Shard',
          amount: 1,
        },
      ])
    ).toEqual([
      {
        item_id: '0xminted-item',
        template_id,
        item_type: 'resource',
        icon_slug: 'post_receipt_starfell_shard',
        name: 'Starfell Shard',
        amount: 1,
      },
    ])
  })
})
