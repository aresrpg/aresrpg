// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fileURLToPath } from 'node:url'

import { roll_quality, stat_names } from '@aresrpg/immutable'

import items from '../../../seed/content/items.json'
import mobs from '../../../seed/content/mobs.json'

import { format_sui } from './card.ts'
import { interpolate, type Copy } from './copy.ts'
import type { Notification, Sale, Gathering, Victory, Loot } from './notification.ts'

export type VisualCard = Readonly<{
  type: string
  title: string
  subtitle: string
  image: string | null
  tone: 'gold' | 'blue'
  summary?: string
  currency?: boolean
  party: readonly string[]
  stats: readonly Readonly<{ key: string; value: number; label: string }>[]
}>
export type Announcement = Readonly<{ content: string; visual: VisualCard }>
const titleize = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const icon = (kind: 'items' | 'mobs', slug: string): string =>
  fileURLToPath(new URL(`../../../seed/icons/${kind}/${slug}.png`, import.meta.url))
const markdown = (value: string): string => value.replace(/[\\`*_~|<>[\]()]/g, '\\$&').replace(/@/g, '@\u200b')
export const actors = (notification: Notification): readonly string[] => {
  switch (notification.kind) {
    case 'sale':
      return [notification.seller]
    case 'gather':
    case 'loot':
      return [notification.address]
    case 'victory':
      return notification.winners
  }
}
const player = (names: Readonly<Record<string, string | null>>, address: string) =>
  names[address] ?? `${address.slice(0, 6)}…${address.slice(-4)}`
const message = (template: string, values: Readonly<Record<string, string>>) =>
  interpolate(template, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, markdown(value)])))
const sale_announcement = (
  copy: Copy,
  names: Readonly<Record<string, string | null>>,
  notification: Sale
): Announcement | null => {
  const seller = player(names, notification.seller)
  return {
    content: message(copy.sale, {
      seller,
      item: notification.name,
      amount: String(notification.amount),
      price: format_sui(notification.price_mist),
    }),
    visual: {
      type: copy.title,
      title: `${notification.amount}× ${notification.name}`,
      subtitle: interpolate(copy.sold_by, { player: seller }),
      image: notification.item_type ? icon('items', notification.item_type) : null,
      tone: 'gold',
      currency: true,
      party: [],
      stats: [],
      summary: format_sui(notification.price_mist),
    },
  }
}

const gather_announcement = (
  copy: Copy,
  names: Readonly<Record<string, string | null>>,
  notification: Gathering
): Announcement | null => {
  const item = items.find(({ item_type }) => item_type === notification.item_type)
  const name = item?.name ?? titleize(notification.item_type)
  const finder = player(names, notification.address)
  return {
    content: message(copy.gather, { player: finder, item: name }),
    visual: {
      type: copy.gather_title,
      title: name,
      subtitle: interpolate(copy.found_by, { player: finder }),
      image: icon('items', notification.item_type),
      tone: 'blue',
      summary: '×1',
      party: [],
      stats: [],
    },
  }
}

const victory_announcement = (
  copy: Copy,
  names: Readonly<Record<string, string | null>>,
  notification: Victory
): Announcement | null => {
  const boss = mobs.find((mob) => notification.mob_types.includes(mob.mob_type) && mob.role === 'boss')
  const name = boss?.name ?? titleize(notification.dungeon)
  const party = notification.winners.map((address) => player(names, address))
  return {
    content: message(copy.victory, { party: party.join(', '), boss: name }),
    visual: {
      type: copy.victory_title,
      title: name,
      subtitle: `${titleize(notification.dungeon)} · ${copy.boss_defeated}`,
      image: boss ? icon('mobs', boss.mob_type) : null,
      tone: 'gold',
      party,
      stats: [],
    },
  }
}

const loot_announcement = (
  copy: Copy,
  names: Readonly<Record<string, string | null>>,
  notification: Loot
): Announcement | null => {
  const template = items.find(({ item_type }) => item_type === notification.item_type)
  if (!template?.stats) throw new Error(`Missing authored stat ranges: ${notification.item_type}`)
  const quality = roll_quality(template.stats, notification.stats)
  if (!quality?.exceptional) return null
  const percentage = quality.basis_points < 9010 ? '>90' : (quality.basis_points / 100).toFixed(1)
  return {
    content: message(copy.loot, {
      player: player(names, notification.address),
      quality: percentage,
      item: notification.name,
    }),
    visual: {
      type: copy.loot_title,
      title: notification.name,
      subtitle: `${titleize(notification.category)} · ${copy.level} ${notification.level}`,
      image: icon('items', notification.item_type),
      tone: 'blue',
      summary: `${percentage}%`,
      party: [],
      stats: stat_names
        .filter((key) => (notification.stats[key] ?? 0) !== 0)
        .map((key) => ({ key, value: notification.stats[key]!, label: copy.stats[key] ?? titleize(key) })),
    },
  }
}
export const announcement = (
  copy: Copy,
  names: Readonly<Record<string, string | null>>,
  notification: Notification
): Announcement | null => {
  switch (notification.kind) {
    case 'sale':
      return sale_announcement(copy, names, notification)
    case 'gather':
      return gather_announcement(copy, names, notification)
    case 'victory':
      return victory_announcement(copy, names, notification)
    case 'loot':
      return loot_announcement(copy, names, notification)
  }
}
