// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  OfferCaps,
  trade_cap_action,
  trade_display_name,
  trade_inventory_category,
  trade_modal_visible,
} from '../../src/components/TradeInbox.tsx'
import {
  stage_trade_addition,
  stage_trade_offer_addition,
  trade_amount_presets,
  trade_offer_draft_key,
  trade_draft_inventory,
  trade_side_status,
} from '../../src/components/trade_view.ts'

const cap = {
  object: '0xitem',
  name: 'Wool',
  level: 1,
  amount: 10,
  item_type: 'wool',
  category: 'resource',
  kiosk: '0xkiosk',
} satisfies TradeCapRow
const trade = (phase: TradeRow['phase']): TradeRow => ({
  id: '0xt',
  a: '0xme',
  b: '0xher',
  phase,
  offer_revision: 1,
  accept_a: false,
  accept_b: false,
  sui_a: '0',
  sui_b: '0',
  kares_a: '0',
  kares_b: '0',
  caps_a: [cap],
  caps_b: [cap],
})
const text = (key: string) => key

test('only a negotiating own offer item exposes a remove action', () => {
  expect(trade_cap_action({ phase: 'negotiating', own: true })).toBe('withdraw')
  expect(trade_cap_action({ phase: 'negotiating', own: false })).toBeNull()
  expect(trade_cap_action({ phase: 'settling', own: true })).toBeNull()
  expect(trade_cap_action({ phase: 'cancelled', own: true })).toBeNull()
})

test('the opponent offer can be inspected but never withdrawn in any phase', () => {
  for (const phase of ['negotiating', 'settling', 'cancelled'] as const) {
    const markup = renderToStaticMarkup(
      <OfferCaps caps={[cap]} own={false} pending={false} text={text} trade={trade(phase)} />
    )
    expect(markup).not.toContain(`aria-label="${text('remove_item')}"`)
    expect(markup).toContain(`aria-label="${cap.name}"`)
  }
  const own = renderToStaticMarkup(
    <OfferCaps caps={[cap]} own pending={false} text={text} trade={trade('negotiating')} />
  )
  expect(own).toContain(`aria-label="${text('remove_item')}"`)
})

test('an offer always shows its slots, filled first, without an empty-state sentence', () => {
  const markup = renderToStaticMarkup(
    <OfferCaps caps={[cap]} own pending={false} text={text} trade={trade('negotiating')} />
  )
  expect(markup.match(/trade-slot is-empty/g)).toHaveLength(32)
  expect(markup.indexOf(`aria-label="${cap.name}"`)).toBeLessThan(markup.indexOf('is-empty'))
  expect(markup).toContain('×10')
})

test('side status follows the escrow row; only the own draft marks editing', () => {
  const row = trade('negotiating')
  expect(trade_side_status(row, 'a', true, false)).toBe('not_accepted')
  expect(trade_side_status(row, 'b', false, false)).toBe('reviewing')
  expect(trade_side_status({ ...row, accept_b: true }, 'b', false, true)).toBe('accepted')
  expect(trade_side_status({ ...row, accept_a: true }, 'a', true, true)).toBe('editing')
  expect(trade_side_status(trade('settling'), 'b', false, false)).toBe('accepted')
  expect(trade_side_status(trade('cancelled'), 'a', true, true)).toBe('cancelled')
})

test('amount presets stay ascending and never repeat an amount', () => {
  expect(trade_amount_presets(98)).toEqual([
    { amount: 1, label: null },
    { amount: 10, label: null },
    { amount: 49, label: 'amount_half' },
    { amount: 98, label: 'amount_all' },
  ])
  expect(trade_amount_presets(12).map(({ amount }) => amount)).toEqual([1, 6, 10, 12])
  expect(trade_amount_presets(2)).toEqual([
    { amount: 1, label: 'amount_half' },
    { amount: 2, label: 'amount_all' },
  ])
})

test('negotiations stay visible while drained terminal rows close', () => {
  expect(trade_modal_visible({ ...trade('negotiating'), caps_a: [], caps_b: [] })).toBeTrue()
  expect(trade_modal_visible({ ...trade('settling'), caps_a: [], caps_b: [] })).toBeFalse()
  expect(trade_modal_visible(trade('requested'))).toBeFalse()
})

test('trade identities prefer known character names without inventing durable identity', () => {
  const players = [
    { owner: '0xher', name: 'Nyx' },
    { owner: '0xother', name: 'Rho' },
  ]
  expect(trade_display_name('0xme', '0xme', 'Ari', players)).toBe('Ari')
  expect(trade_display_name('0xher', '0xme', 'Ari', players)).toBe('Nyx')
  expect(trade_display_name('0xunknown-address', '0xme', 'Ari', players)).toBe('0xunkno…dress')
})

test('trade inventory uses the established three bag filters', () => {
  expect(trade_inventory_category({ category: 'hat' } as never)).toBe('equipment')
  expect(trade_inventory_category({ category: 'consumable' } as never)).toBe('consumables')
  expect(trade_inventory_category({ category: 'rune' } as never)).toBe('resources')
})

test('a partial staged stack remains in inventory with its residual amount', () => {
  const item = { ...cap, id: cap.object } as ItemRow
  const additions = stage_trade_addition([], item, 4)
  expect(trade_draft_inventory([item], new Set(), additions)).toEqual([{ ...item, amount: 6 }])
  expect(stage_trade_addition(additions, item, 3)[0]?.amount).toBe(7)
  expect(trade_draft_inventory([item], new Set(), stage_trade_addition(additions, item, 6))).toEqual([])
})

test('adding a stackable type already in the offer replaces it with one combined draft cap', () => {
  const offered = { ...cap, amount: 1 }
  const item = { ...cap, id: '0xsource', amount: 1 } as ItemRow
  expect(stage_trade_offer_addition([], [offered], item, 1)).toEqual({
    additions: [{ item: { ...item, amount: 2 }, amount: 2 }],
    kept_caps: [],
  })
})

test('a staged offer removal reappears once in draft inventory', () => {
  const { object: id, ...item } = cap
  const returned = trade_draft_inventory([], new Set([cap.object]), [], [{ cap }])
  expect(returned).toEqual([{ ...item, id }])
  expect(trade_draft_inventory(returned, new Set([cap.object]), [], [{ cap }])).toEqual(returned)
})

test('a staged offer removal merges into the matching draft inventory stack', () => {
  const offered = { ...cap, amount: 1 }
  const target = { ...cap, id: '0xtarget', amount: 1 } as ItemRow
  const listed_source = { ...offered, id: offered.object } as ItemRow
  const removals = [{ cap: offered, target: { id: target.id, kiosk: target.kiosk, amount: target.amount } }]
  expect(trade_draft_inventory([target, listed_source], new Set([offered.object]), [], removals)).toEqual([
    { ...target, amount: 2 },
  ])
})

test('counterparty confirmation and offer changes never reset my local offer draft', () => {
  const initial = trade('negotiating')
  const key = trade_offer_draft_key(initial, 'b')

  expect(trade_offer_draft_key({ ...initial, accept_a: true }, 'b')).toBe(key)
  expect(
    trade_offer_draft_key({ ...initial, offer_revision: 2, caps_a: [{ ...cap, object: '0xother' }], sui_a: '12' }, 'b')
  ).toBe(key)
  expect(trade_offer_draft_key({ ...initial, caps_b: [{ ...cap, amount: 9 }] }, 'b')).not.toBe(key)
  expect(trade_offer_draft_key({ ...initial, sui_b: '1' }, 'b')).not.toBe(key)
})

test('KARES alone keeps a completed exchange visible and changes its local draft identity', () => {
  const empty = { ...trade('settling'), caps_a: [], caps_b: [] }
  expect(trade_modal_visible(empty)).toBeFalse()
  const funded = { ...empty, kares_a: '1' }
  expect(trade_modal_visible(funded)).toBeTrue()
  expect(trade_offer_draft_key(funded, 'a')).not.toBe(trade_offer_draft_key(empty, 'a'))
  expect(trade_offer_draft_key(funded, 'b')).toBe(trade_offer_draft_key(empty, 'b'))
})
