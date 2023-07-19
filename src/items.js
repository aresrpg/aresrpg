import { isDeepStrictEqual } from 'util'

import minecraftData from 'minecraft-data'
import Nbt from 'prismarine-nbt'

import sets from '../data/sets.json' assert { type: 'json' }

import { VERSION } from './settings.js'
import { random_bias_low } from './math.js'
import { compute_outcomes } from './damage.js'
import { Characteristic, get_total_characteristic } from './characteristics.js'
import { Font } from './font.js'
import { experience_to_level } from './experience.js'
import { compute_string_length } from './ui.js'
import Colors from './colors.js'

const { itemsByName } = minecraftData(VERSION)
// keeping corresponding sets in memory to avoid unnecessary lookups
const SET_BY_ITEM = new Map(
  Object.entries(sets).flatMap(([set_name, { items }]) =>
    items.map(item => [item, sets[set_name]])
  )
)

const TOOLTIP_START_OFFSET = -4
const TOOLTIP_WIDTH = 175
const TOOLTIP_END_OFFSET = -10

// used to split descriptions into multiple lines
const CHARACTERS_PER_LINE = 30

function split_description(description) {
  const length = Math.ceil(description.length / CHARACTERS_PER_LINE)
  return Array.from({ length }, (_, index) =>
    description
      .slice(
        index * CHARACTERS_PER_LINE,
        index * CHARACTERS_PER_LINE + CHARACTERS_PER_LINE
      )
      .trim()
  )
}

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

function get_tooltip_type(type, id) {
  switch (type) {
    case 'misc':
    case 'consumable':
    case 'relic':
    case 'rune':
      return type
    default:
      return SET_BY_ITEM.has(id) ? 'set' : 'item'
  }
}

function get_descriptive_type(type) {
  switch (type) {
    case 'misc':
    case 'consumable':
    case 'rune':
      return type
    default:
      return `equipment (${type})`
  }
}

function insert_if(condition, ...value) {
  return condition ? value : []
}

function get_stat_color(element) {
  switch (element) {
    case 'vitality':
      return Colors.DARK_RED
    case 'mind':
      return Colors.PURPLE
    case 'strength':
      return Colors.BROWN
    case 'intelligence':
      return Colors.RED
    case 'chance':
      return Colors.BLUE
    case 'agility':
      return Colors.GREEN
    case 'speed':
      return Colors.DARK_GREEN
    case 'reach':
      return Colors.SKY
    case 'haste':
      return Colors.YELLOW
    case 'raw_damage':
      return Colors.ORANGE
  }
}

function get_element_color(element) {
  switch (element) {
    case 'earth':
      return get_stat_color('strength')
    case 'water':
      return get_stat_color('chance')
    case 'air':
      return get_stat_color('agility')
    default:
      return get_stat_color('intelligence')
  }
}

function get_damage_type_displayname(type) {
  switch (type) {
    case 'life_steal':
      return 'life steal'
    default:
      return type
  }
}

/** @type {(ares_item: Item, options: import('./context.js').State) => Object} Map an aresrpg item to a minecraft item */
export function to_vanilla_item(
  ares_item,
  { inventory, characteristics, experience }
) {
  if (!ares_item) return empty_slot

  const {
    id,
    name,
    type,
    item,
    level,
    custom_model_data,
    enchanted,
    description,
    stats,
    critical,
    damage = [],
    count = 1,
  } = ares_item

  // const display_name = {
  //   text: name,
  //   italic: false,
  //   color: 'white',
  //   ...(level != null && {
  //     extra: [
  //       { text: ' <' },
  //       { text: `Lvl ${level}`, color: 'dark_green' },
  //       { text: '>' },
  //     ],
  //   }),
  // }

  const base_outcomes = critical?.outcomes ?? 100
  const agility = get_total_characteristic(Characteristic.AGILITY, {
    inventory,
    characteristics,
  })
  const critical_outcomes = compute_outcomes({ base_outcomes, agility })
  const player_level = experience_to_level(experience)
  const tooltip_type = get_tooltip_type(type, id)
  const name_length = compute_string_length(name, 1.2)

  function middle_component(...components) {
    return JSON.stringify([
      Font.SPACE.cursor(TOOLTIP_START_OFFSET),
      Font.ITEM.tooltip_middle(tooltip_type),
      Font.SPACE.cursor(-TOOLTIP_WIDTH),
      ...components,
      Font.SPACE.cursor(TOOLTIP_END_OFFSET),
    ])
  }

  // const lore = Object.entries({
  //   name,
  //   type,
  //   item,
  //   level,
  //   custom_model_data,
  //   enchanted,
  //   description: !!description,
  //   stats: JSON.stringify(stats),
  //   ...(critical && {
  //     critical: `1/${critical_outcomes} (+${critical.bonus})`,
  //     critical_default: `1/${base_outcomes}`,
  //   }),
  //   damage: JSON.stringify(damage),
  // }).map(([key, value]) => ({ text: `${key}: ${value}` }))

  return {
    present: true,
    itemId: itemsByName[item]?.id,
    itemCount: count,
    // https://minecraft.gamepedia.com/Player.dat_format#Item_structure
    nbtData: Nbt.comp({
      CustomModelData: Nbt.int(custom_model_data),
      display: Nbt.comp({
        Name: Nbt.string(
          JSON.stringify([
            Font.SPACE.cursor(-4),
            Font.ITEM.tooltip_top(tooltip_type),
            Font.SPACE.cursor(-TOOLTIP_WIDTH),
            Font.SPACE.cursor((TOOLTIP_WIDTH - name_length) / 2),
            Font.SPACE.cursor(4), // title padding
            Font.ITEM_ASCII(name, Colors.WHITE),
            Font.SPACE.negative_max,
          ])
        ),
        Lore: Nbt.list(
          Nbt.string([
            // ============ item type
            middle_component(
              Font.SPACE.cursor(20),
              Font.ITEM_LEVEL_ASCII(get_descriptive_type(type), Colors.SKY)
            ),
            // ============ item level
            middle_component(
              Font.ITEM.type_icon(type),
              Font.SPACE.cursor(3),
              ...insert_if(
                level != null,
                Font.ITEM_LEVEL_ASCII('Lvl ', Colors.DARK_GRAY, {
                  italic: false,
                }),
                Font.ITEM_LEVEL_ASCII(
                  level,
                  level > player_level ? Colors.DARK_RED : Colors.DARK_GREEN,
                  { italic: false }
                )
              )
            ),
            // ============ space
            middle_component(),
            // ============ item damages
            ...insert_if(
              damage.length,
              ...damage.map(({ from, to, type, element = '' }) =>
                middle_component(
                  Font.ITEM_ASCII(from, Colors.GRAY),
                  Font.ITEM_ASCII(' to ', Colors.DARK_GRAY),
                  Font.ITEM_ASCII(`${to} `, Colors.GRAY),
                  Font.ITEM_ASCII(
                    get_damage_type_displayname(type),
                    Colors.DARK_GRAY
                  ),
                  ...insert_if(
                    element,
                    Font.ITEM_ASCII(` ${element}`, get_element_color(element))
                  )
                )
              ),
              // ============ space
              middle_component()
            ),
            // ============ item critical
            ...insert_if(
              critical,
              middle_component(
                Font.ITEM_ASCII('1', Colors.GRAY),
                Font.ITEM_ASCII('/', Colors.DARK_GRAY),
                Font.ITEM_ASCII(critical_outcomes, Colors.GRAY),
                Font.ITEM_ASCII(' (', Colors.DARK_GRAY),
                Font.ITEM_ASCII(`+${critical?.bonus}`, Colors.GRAY),
                Font.ITEM_ASCII(')', Colors.DARK_GRAY),
                Font.ITEM_ASCII(' criticals', Colors.DARK_GRAY)
              ),
              // ============ space
              middle_component()
            ),
            // ============ item stats
            ...Object.entries(stats).map(([stat_name, stat_value]) => {
              const sign = stat_value < 0 ? '-' : ''
              const stat_color = stat_value < 0 ? Colors.RED : Colors.GRAY
              const normalized_stat_value = Math.abs(stat_value)

              return middle_component(
                Font.SPACE.cursor(3),
                Font.ITEM.stat_icon(stat_name),
                Font.SPACE.cursor(5),
                Font.ITEM_ASCII(`${sign}${normalized_stat_value} `, stat_color),
                Font.ITEM_ASCII(stat_name, get_stat_color(stat_name))
              )
            }),
            // ============ space
            middle_component(),
            // ============ item description
            ...insert_if(
              description,
              ...split_description(description).map(line =>
                middle_component(
                  Font.ITEM_LEVEL_ASCII(line, Colors.DARKER_GRAY, {
                    italic: true,
                  })
                )
              )
            ),
            // ============ footer
            JSON.stringify([
              Font.SPACE.cursor(TOOLTIP_START_OFFSET),
              Font.ITEM.tooltip_bottom(tooltip_type),
              Font.SPACE.cursor(TOOLTIP_END_OFFSET),
            ]),
          ])
        ),
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

export function is_yielding_weapon({ held_slot_index, inventory: { weapon } }) {
  return weapon && Array.isArray(weapon.damage)
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

/**
 * Compute the final drop_chance based on multiple factors
 * @param {number} base_drop_chance the drop percentage 10 means 10%
 */
export function should_loot(base_drop_chance, { inventory, characteristics }) {
  const chance = get_total_characteristic(Characteristic.CHANCE, {
    inventory,
    characteristics,
  })
  const prospection = chance / 10 + 100
  const drop_chance = (base_drop_chance * prospection) / 100
  return Math.random() * 100 < drop_chance
}
