import { isDeepStrictEqual } from 'util'

import minecraftData from 'minecraft-data'
import Nbt from 'prismarine-nbt'

import { VERSION } from './settings.js'
import { random_bias_low } from './math.js'

const { itemsByName } = minecraftData(VERSION)

/** @typedef {import('./types').ItemTemplate} ItemTemplate */
/** @typedef {import('./types').ItemStatisticsTemplate} ItemStatisticsTemplate */
/** @typedef {import('./types').ItemStatistics} ItemStatistics */
/** @typedef {import('./types').Item} Item */

export const empty_slot = {
  present: false,
}

export function split_item(item, amount = Math.floor(item.count / 2)) {
  return [
    { ...item, count: amount },
    { ...item, count: item.count - amount },
  ]
}

export function similar(target_item, source_item) {
  return isDeepStrictEqual(
    { ...target_item, count: 0 },
    { ...source_item, count: 0 }
  )
}

export function assign_items(
  target_item,
  source_item,
  amount = source_item.count
) {
  const normalized_amount = Math.min(amount, source_item.count)
  return (
    [
      {
        ...target_item,
        count: target_item.count + normalized_amount,
      },
      {
        ...source_item,
        count: source_item.count - normalized_amount,
      },
    ]
      // second item not needed if negative count
      .filter(({ count }) => count > 0)
  )
}

/** Map an aresrpg item to a minecraft item */
export function to_vanilla_item(ares_item) {
  if (!ares_item) return empty_slot

  const {
    name,
    type,
    item,
    level,
    custom_model_data,
    enchanted,
    description,
    stats,
    critical,
    damage,
    count = 1,
  } = ares_item

  const display_name = {
    text: name,
    italic: false,
    color: 'white',
    extra: level && [
      { text: ' <' },
      { text: `Lvl ${level}`, color: 'dark_green' },
      { text: '>' },
    ],
  }

  const lore = Object.entries({
    name,
    type,
    item,
    level,
    custom_model_data,
    enchanted,
    description: !!description,
    stats: JSON.stringify(stats),
    critical: JSON.stringify(critical),
    damage: JSON.stringify(damage),
  }).map(([key, value]) => ({ text: `${key}: ${value}` }))

  return {
    present: true,
    itemId: itemsByName[item].id,
    itemCount: count,
    // https://minecraft.gamepedia.com/Player.dat_format#Item_structure
    nbtData: Nbt.comp({
      CustomModelData: Nbt.int(custom_model_data),
      display: Nbt.comp({
        Name: Nbt.string(JSON.stringify(display_name)),
        Lore: Nbt.list(Nbt.string(lore.map(line => JSON.stringify(line)))),
      }),
      HideFlags: Nbt.int(127),
      ...(enchanted && {
        Enchantments: Nbt.list(
          Nbt.comp([{ id: Nbt.int(0), lvl: Nbt.short(0) }])
        ),
      }),
    }),
  }
}

/** @type {(stats: ItemStatisticsTemplate) => ItemStatistics} */
function generate_stats(stats) {
  return Object.fromEntries(
    Object.entries(stats)
      // only keep existing stats (not 0)
      .filter(([, [from, to]]) => from || to)
      .map(([stat_name, [from, to]]) => [stat_name, random_bias_low(from, to)])
      .filter(([name, value]) => !!value)
  )
}

/** @type {(state) => Item | null} */
export function get_held_item({
  held_slot_index,
  inventory: { hotbar, weapon },
}) {
  const hotbar_with_weapon = [weapon, ...hotbar.slice(1)]
  return hotbar_with_weapon[held_slot_index]
}

export function is_yielding_weapon({ held_slot_index, inventory: { weapon } }) {
  return held_slot_index === 0 && weapon
}

/** @type {(item: ItemTemplate, count?: number) => Item} */
export function generate_item({ stats, ...template }, count = 1) {
  if (stats)
    return {
      ...template,
      stats: generate_stats(stats),
      count,
    }

  return {
    ...template,
    count,
  }
}
