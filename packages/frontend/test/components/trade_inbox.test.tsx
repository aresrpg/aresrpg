// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

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
  trade_draft_inventory,
} from '../../src/components/trade_view.ts'

const dialog_source = ['../../src/components/TradeDialog.tsx', '../../src/components/TradeOfferCaps.tsx']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n')
const source = ['../../src/components/TradeInbox.tsx']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .concat(dialog_source)
  .join('\n')
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

test('the rendered opponent offer has no button in any phase', () => {
  for (const phase of ['negotiating', 'settling', 'cancelled'] as const) {
    const markup = renderToStaticMarkup(
      <OfferCaps caps={[cap]} own={false} pending={false} text={text} trade={trade(phase)} />
    )
    expect(markup).not.toContain('<button')
  }
  const own = renderToStaticMarkup(
    <OfferCaps caps={[cap]} own pending={false} text={text} trade={trade('negotiating')} />
  )
  expect(own).toContain('<button')
})

test('the trade surface has no per-item or per-SUI claim dispatch', () => {
  expect(source).not.toContain("type: 'trade/claim_cap'")
  expect(source).not.toContain("type: 'trade/claim_sui'")
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

test('Zustand trade selectors retain store-owned references', () => {
  expect(source).not.toContain('useAppStore((state) => Object.values(state.world.players))')
  expect(source).not.toContain('useAppStore((state) => state.world.players)')
  expect(source).toContain('useAppStore((state) => state.world.all_players)')
})

test('trade inventory uses the established three bag filters', () => {
  expect(trade_inventory_category({ category: 'hat' } as never)).toBe('equipment')
  expect(trade_inventory_category({ category: 'consumable' } as never)).toBe('consumables')
  expect(trade_inventory_category({ category: 'rune' } as never)).toBe('resources')
  expect(source).toContain('<SuiUnit size={12} />')
  expect(source).not.toContain('<Coins')
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

test('trade offer cells reuse the shared item snapshot tooltip', () => {
  expect(dialog_source).toContain('useItemSnapshotHover(props.cap.object)')
  expect(dialog_source).toContain('<ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />')
})

test('draft confirmation belongs to Your Offer, never the acceptance footer', () => {
  const offer = dialog_source.slice(
    dialog_source.indexOf('const OfferPanel'),
    dialog_source.indexOf('const TradeInventory')
  )
  const footer = dialog_source.slice(
    dialog_source.indexOf('const NegotiatingFooter'),
    dialog_source.indexOf('const TradeAmountModal')
  )
  expect(offer).toContain("text('confirm_changes')")
  expect(offer).toContain("text('discard_changes')")
  expect(footer).not.toContain("text('confirm_changes')")
  expect(footer).toContain("type: 'trade/accept'")
})

test('acceptance cost detail stays available without occupying the action bar', () => {
  expect(source).not.toContain("<p>{text('accept_notice'")
  expect(source).toContain('title={notice}')
})
