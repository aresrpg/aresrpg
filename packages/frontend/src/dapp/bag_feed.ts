// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'

import { held_items, type DappAccount } from './account.ts'

/** Item types the feed keeps; a type gained again moves to the front, the oldest ones drop out. */
export const BAG_FEED_KEPT = 24

export type BagGain = Readonly<{ item_type: string; amount: number }>
/**
 * What entered the bot's bag, newest first, whatever brought it: a fight, a harvest, a purchase or a
 * transfer. The bag itself is the durable truth; this is only a convenience kept on the device.
 */
export type BagFeed = Readonly<{
  /** Units by item type in the last bag folded. Null until a bag is known: the first one is the baseline. */
  seen: Readonly<Record<string, number>> | null
  gains: readonly BagGain[]
  /** The rows last folded, so the same account seen again costs nothing. Never stored. */
  rows: readonly ItemRow[] | null
}>
export const EMPTY_BAG_FEED: BagFeed = Object.freeze({ seen: null, gains: [], rows: null })

const with_gain = (gains: readonly BagGain[], { item_type, amount }: BagGain): readonly BagGain[] => {
  const known = gains.find((gain) => gain.item_type === item_type)
  return [
    { item_type, amount: (known?.amount ?? 0) + amount },
    ...gains.filter((gain) => gain.item_type !== item_type),
  ].slice(0, BAG_FEED_KEPT)
}

/**
 * Folds the bag by value. Only increases are told; an item sold, used or moved out changes the
 * baseline and nothing else. A feed restored from the device still holds the bag it last saw, so the
 * first bag after a reconnect tells everything that arrived meanwhile.
 */
export const advance_bag_feed = (feed: BagFeed, account: DappAccount): BagFeed => {
  if (account.phase !== 'ready' || account.inventory === feed.rows) return feed
  const [seen, rows] = [held_items(account.inventory), account.inventory]
  if (!feed.seen) return { ...feed, seen, rows }
  const before = feed.seen
  // The same units under new rows change nothing: the state stays the same object.
  const same = Object.keys(seen).length === Object.keys(before).length
  if (same && Object.entries(seen).every(([item_type, amount]) => before[item_type] === amount)) return feed
  const gained = Object.entries(seen)
    .map(([item_type, amount]) => ({ item_type, amount: amount - (before[item_type] ?? 0) }))
    .filter(({ amount }) => amount > 0)
  return { seen, rows, gains: gained.reduce(with_gain, feed.gains) }
}

/** What the last fold added, for the effect that announces it. A restored feed announces nothing. */
export const new_gains = (feed: BagFeed, previous: BagFeed): readonly BagGain[] => {
  if (feed.rows === previous.rows || !previous.rows) return []
  return feed.gains.flatMap(({ item_type, amount }) => {
    const added = amount - (previous.gains.find((gain) => gain.item_type === item_type)?.amount ?? 0)
    return added > 0 ? [{ item_type, amount: added }] : []
  })
}

const counts = (value: unknown): Readonly<Record<string, number>> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  return entries.every(([, amount]) => Number.isSafeInteger(amount) && amount >= 0)
    ? (Object.fromEntries(entries) as Record<string, number>)
    : null
}
const gain_row = (value: unknown): readonly BagGain[] => {
  const { item_type, amount } = (value ?? {}) as Readonly<Record<string, unknown>>
  return typeof item_type === 'string' && Number.isSafeInteger(amount) && (amount as number) > 0
    ? [{ item_type, amount: amount as number }]
    : []
}
/** The feed as the device stores it. Anything unreadable is an empty feed, never an error. */
export const encode_bag_feed = ({ seen, gains }: BagFeed): string => JSON.stringify({ seen, gains })
export const decode_bag_feed = (stored: string | null): BagFeed => {
  if (!stored) return EMPTY_BAG_FEED
  try {
    const value = JSON.parse(stored) as Readonly<{ seen?: unknown; gains?: unknown }> | null
    const seen = counts(value?.seen)
    if (!seen || !Array.isArray(value?.gains)) return EMPTY_BAG_FEED
    return { seen, gains: value.gains.flatMap(gain_row).slice(0, BAG_FEED_KEPT), rows: null }
  } catch (error) {
    console.warn('The saved bag feed is unreadable and starts empty.', error)
    return EMPTY_BAG_FEED
  }
}
