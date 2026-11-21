// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  advance_bag_feed,
  decode_bag_feed,
  encode_bag_feed,
  new_gains,
  BAG_FEED_KEPT,
  EMPTY_BAG_FEED,
} from '../../src/dapp/bag_feed.ts'

import { account_fixture, item_fixture } from './fixtures.ts'

const bag = (...items: readonly (readonly [string, number])[]) =>
  account_fixture({ items: items.map(([type, amount]) => item_fixture(type, amount, `${type}-1`)) })

test('the first bag is the baseline; later increases are told once, whatever brought them', () => {
  const first = bag(['wheat', 5])
  const begun = advance_bag_feed(EMPTY_BAG_FEED, first)
  expect(begun).toMatchObject({ seen: { wheat: 5 }, gains: [] })
  const richer = bag(['wheat', 9], ['ore', 2])
  const gained = advance_bag_feed(begun, richer)
  expect(gained.gains).toEqual([
    { item_type: 'ore', amount: 2 },
    { item_type: 'wheat', amount: 4 },
  ])
  // The same account seen again is the same feed: no second count, no new announcement.
  expect(advance_bag_feed(gained, richer)).toBe(gained)
  expect(new_gains(gained, begun)).toEqual([
    { item_type: 'ore', amount: 2 },
    { item_type: 'wheat', amount: 4 },
  ])
  expect(new_gains(gained, gained)).toEqual([])
  // A sale or a use only moves the baseline; what arrived stays told.
  const sold = advance_bag_feed(gained, bag(['wheat', 1], ['ore', 2]))
  expect(sold.gains).toEqual(gained.gains)
  expect(new_gains(sold, gained)).toEqual([])
  // The same item arriving again adds to its row and moves it first.
  const again = advance_bag_feed(sold, bag(['wheat', 4], ['ore', 2]))
  expect(again.gains).toEqual([
    { item_type: 'wheat', amount: 7 },
    { item_type: 'ore', amount: 2 },
  ])
  expect(new_gains(again, sold)).toEqual([{ item_type: 'wheat', amount: 3 }])
  // A bag not read yet moves nothing.
  expect(advance_bag_feed(again, { ...bag(['wheat', 50]), phase: 'loading' })).toBe(again)
})

test('a feed restored from the device tells what arrived while the page was away, without announcing it', () => {
  const live = advance_bag_feed(advance_bag_feed(EMPTY_BAG_FEED, bag(['wheat', 5])), bag(['wheat', 6]))
  const restored = decode_bag_feed(encode_bag_feed(live))
  expect(restored).toEqual({ seen: { wheat: 6 }, gains: [{ item_type: 'wheat', amount: 1 }], rows: null })
  // On reconnect the bag holds a key and more wheat: both are told, whatever their source.
  const reconciled = advance_bag_feed(restored, bag(['wheat', 8], ['key', 1]))
  expect(reconciled.gains).toEqual([
    { item_type: 'key', amount: 1 },
    { item_type: 'wheat', amount: 3 },
  ])
  expect(new_gains(reconciled, restored)).toEqual([])
})

test('the feed keeps the most recently gained item types and drops the oldest', () => {
  const types = Array.from({ length: BAG_FEED_KEPT + 3 }, (_, index) => `item_${index}`)
  const grown = types.reduce(
    (feed, _type, index) => advance_bag_feed(feed, bag(...types.slice(0, index + 1).map((type) => [type, 1] as const))),
    advance_bag_feed(EMPTY_BAG_FEED, bag())
  )
  expect(grown.gains).toHaveLength(BAG_FEED_KEPT)
  expect(grown.gains[0]).toEqual({ item_type: types.at(-1)!, amount: 1 })
  expect(grown.gains.some(({ item_type }) => item_type === 'item_0')).toBe(false)
})

test('unreadable device data is an empty feed, never an error', () => {
  for (const stored of [
    null,
    '',
    'not json',
    'null',
    '[]',
    '{"seen":{"wheat":-1},"gains":[]}',
    '{"seen":{},"gains":1}',
  ])
    expect(decode_bag_feed(stored)).toBe(EMPTY_BAG_FEED)
  expect(
    decode_bag_feed('{"seen":{"wheat":2},"gains":[{"item_type":"wheat","amount":0},{"item_type":7,"amount":1}]}')
  ).toEqual({
    seen: { wheat: 2 },
    gains: [],
    rows: null,
  })
})
