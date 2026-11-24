// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The detail views of the bot's one read path. `bot_observe` says what the wallet holds and does in a
// few kilobytes; a bag, the stacks of one item and the zones around a hero are asked for by name.
// Owner ruling 2026-11-22: an observation is a status, never a dump of packets, bags and zones.
import { encumbered_asset_ids } from '@aresrpg/protocol/inventory'
import { zone_of, type CharacterRow, type ItemRow } from '@aresrpg/protocol'

import { empty_inventory, inventory_read, type ActorInventory } from './actor_inventory.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { zone_key } from './actor_world.ts'
import { item_bonuses } from './character_observability.ts'
import { zone_checkpoint_id } from './gameplay_context.ts'
import { zone_knowledge } from './catalog.ts'

/** A value without the keys that hold nothing: an absent fact is absent, never `null`. */
export const without_nulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(without_nulls)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .map(([key, entry]) => [key, without_nulls(entry)])
  )
}

const read_inventory = (inventory: ActorInventory | undefined) => {
  if (!inventory_read(inventory)) throw new Error('inventory_unavailable')
  return inventory
}
/** How much the wallet holds, in counts: the status never lists a bag. */
export const inventory_counts = (inventory: ActorInventory = empty_inventory()) => {
  const count = (rows: readonly unknown[] | null) => rows?.length ?? 0
  return {
    loaded: inventory.loaded,
    stacks: inventory.items.length,
    item_types: new Set(inventory.items.map(({ item_type }) => item_type)).size,
    listings: count(inventory.listings),
    trades: count(inventory.trades),
    claims: count(inventory.claims),
  }
}

type Filter = Readonly<{ category?: string; kiosk?: string; item_type?: string }>
const kept = (items: readonly ItemRow[], { category, kiosk, item_type }: Filter) =>
  items.filter(
    (item) =>
      (!category || item.category === category) &&
      (!kiosk || item.kiosk === kiosk) &&
      (!item_type || item.item_type === item_type)
  )
/** The bag as a player reads it: one line per item and kiosk, with what is free to use. Stacks,
 * object ids and versions are detail: `stacks_view` gives them for one item. */
export const inventory_view = ({ inventory }: ActorSnapshot, filter: Filter) => {
  const state = read_inventory(inventory)
  const encumbered = encumbered_asset_ids(state.listings, state.trades)
  const lines = new Map<
    string,
    {
      item_type: string
      name: string
      category: string
      level: number
      kiosk: string
      amount: number
      available: number
      stacks: number
    }
  >()
  for (const item of kept(state.items, filter)) {
    const key = `${item.kiosk}:${item.item_type}`
    const line = lines.get(key) ?? {
      item_type: item.item_type,
      name: item.name,
      category: item.category,
      level: item.level,
      kiosk: item.kiosk,
      amount: 0,
      available: 0,
      stacks: 0,
    }
    lines.set(key, {
      ...line,
      amount: line.amount + item.amount,
      available: line.available + (encumbered.has(item.id) ? 0 : item.amount),
      stacks: line.stacks + 1,
    })
  }
  return { items: [...lines.values()], listings: state.listings, trades: state.trades, claims: state.claims }
}

/** How many stacks of one item a read returns unless it asks for more (product choice, owner
 * disclosure 2026-11-22: a wallet held 330 stacks of one mushroom). The largest come first. */
export const STACKS_DEFAULT = 20
export const STACKS_MAXIMUM = 200
/** The stacks of one item: the object ids a sale, an equip or a craft names. */
export const stacks_view = ({ inventory }: ActorSnapshot, filter: Filter & Readonly<{ limit?: number }>) => {
  const state = read_inventory(inventory)
  const encumbered = encumbered_asset_ids(state.listings, state.trades)
  const rows = kept(state.items, filter).toSorted(
    (left, right) => right.amount - left.amount || left.id.localeCompare(right.id)
  )
  const [first] = rows
  return {
    item_type: filter.item_type,
    name: first?.name,
    category: first?.category,
    level: first?.level,
    total_stacks: rows.length,
    total_amount: rows.reduce((total, { amount }) => total + amount, 0),
    stacks: rows.slice(0, filter.limit ?? STACKS_DEFAULT).map((item) => ({
      id: item.id,
      kiosk: item.kiosk,
      amount: item.amount,
      ...(encumbered.has(item.id) ? { encumbered: true } : {}),
      ...(item.stats ? { stats: item.stats, bonuses: item_bonuses(item) } : {}),
    })),
  }
}

/** The zone each hero stands in, by the key the zone views and checkpoints use. */
export const current_zones = (characters: readonly CharacterRow[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    characters.flatMap((character) => {
      const { world, x, z } = character
      if (!world || x === undefined || z === undefined) return []
      const { zx, zz } = zone_of(x, z)
      return [[character.id, zone_key(world, zx, zz)]]
    })
  )
type ZoneAsk = Readonly<{ character_id?: string; nearby?: boolean; mobs?: boolean; resources?: boolean }>
/**
 * The zones the heroes stand in, or with `nearby` every zone the game tracks around them. A zone says
 * how many monster groups and resource packs it holds; the groups and the packs themselves come only
 * when asked for.
 */
export const zones_view = (snapshot: ActorSnapshot, ask: ZoneAsk) => {
  const heroes = snapshot.characters.filter(({ id }) => !ask.character_id || id === ask.character_id)
  const standing = current_zones(heroes)
  const tracked = new Set(
    heroes.flatMap(({ id }) => {
      const packet = snapshot.tracked_zones[id]
      return packet ? packet.zones.map(({ zx, zz }) => zone_key(packet.world, zx, zz)) : []
    })
  )
  const wanted = ask.nearby ? new Set([...tracked, ...Object.values(standing)]) : new Set(Object.values(standing))
  return {
    zones: Object.entries(snapshot.zones)
      .filter(([key]) => wanted.has(key))
      .map(([key, row]) => {
        const { resources, mobs, ...place } = zone_knowledge(row)
        return {
          key,
          ...place,
          heroes: Object.entries(standing).flatMap(([id, zone]) => (zone === key ? [id] : [])),
          ...(row.spawns ? { zone_checkpoint_id: zone_checkpoint_id(row) } : {}),
          mob_groups: mobs?.length,
          resource_packs: resources?.length,
          ...(ask.mobs ? { mobs } : {}),
          ...(ask.resources ? { resources } : {}),
        }
      }),
  }
}
