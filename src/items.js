import minecraftData from 'minecraft-data'

import { VERSION } from './settings.js'

const mcData = minecraftData(VERSION)

const Types = {
  equipment: {
    name: 'Equipement',
    color: 'white',
  },
  weapon: {
    name: 'Arme',
    color: 'white',
  },
  money: {
    name: 'Money',
    color: 'gold',
  },
  item: {
    name: 'Item',
    color: 'white',
  },
  rare_item: {
    name: 'Item Rare',
    color: 'aqua',
  },
  legendary_item: {
    name: 'Item Légendaire',
    color: 'gold',
  },
  scroll: {
    name: 'Parchemin',
    color: 'dark_purple',
  },
  potion: {
    name: 'Consommable',
    color: 'light_purple',
  },
  trophy: {
    name: 'Trophée',
    color: 'light_purple',
  },
  spellbook: {
    name: 'Spécial',
    color: 'dark_purple',
  },
}

const Stats = {
  agility: {
    text: [" d'", 'Agilité'],
    color: 'dark_green',
  },
  protection: {
    text: [' de ', 'Défense'],
    color: 'dark_aqua',
  },
  strength: {
    text: [' de ', 'Force'],
    color: 'yellow',
  },
  armor_penetration: {
    text: [' de ', "Pénétration d'armure"],
    color: 'dark_blue',
  },
  spirit: {
    text: [" d'", 'Esprit'],
    color: 'dark_purple',
  },
  dodge: {
    text: [" d'", 'Esquive'],
    color: 'blue',
  },
  vitality: {
    text: [' de ', 'Vitalité'],
    color: 'light_purple',
  },
  speed: {
    text: [' de ', 'Vitesse'],
    color: 'aqua',
  },
  intelligence: {
    text: [" d'", 'Intelligence'],
    color: 'dark_red',
  },
}

export function item_to_slot(
  {
    item,
    name,
    level,
    type,
    stats = {},
    damage,
    critical,
    description = [],
    enchants = {},
    custom_model_data = 0,
  },
  count
) {
  const { id } = mcData.itemsByName[item]

  const display_name = {
    text: name,
    italic: false,
    color: Types[type].color,
    extra: level && [
      { text: ' <' },
      { text: `Lvl ${level}`, color: 'dark_green' },
      { text: '>' },
    ],
  }

  const stats_lore = Object.entries(stats).map(([stat, value]) => {
    const negative = value < 0
    const color = negative ? undefined : Stats[stat].color

    return {
      text: ' ',
      italic: false,
      color: negative ? 'red' : 'gray',
      extra: [
        { text: negative ? '-' : '+' },
        {
          text: Math.abs(value).toString(),
          color,
        },
        { text: Stats[stat].text[0] },
        {
          text: Stats[stat].text[1],
          color,
        },
      ],
    }
  })

  const description_lore = description.map(text => ({
    text,
    color: 'dark_gray',
    italic: false,
  }))

  const lore = [
    { text: Types[type].name, color: 'yellow', italic: false },
    damage && {
      text: `Dégâts: ${damage.join(' - ')}`,
      color: 'gray',
      italic: false,
    },
    critical && {
      text: 'Critique: ',
      color: 'gray',
      extra: [{ text: `${critical * 100}%`, color: 'red' }],
      italic: false,
    },
    description_lore.length > 0 && { text: '' },
    description_lore.length > 0 && {
      text: 'Description :',
      color: 'dark_gray',
      underlined: true,
      italic: false,
    },
    ...description_lore,
    stats_lore.length && [{ text: '' }],
    ...stats_lore,
  ].filter(v => typeof v === 'object')

  return {
    present: true,
    itemId: id,
    itemCount: count,
    // https://minecraft.gamepedia.com/Player.dat_format#Item_structure
    nbtData: {
      type: 'compound',
      name: 'tag',
      value: {
        display: {
          type: 'compound',
          value: {
            Name: {
              type: 'string',
              value: JSON.stringify(display_name),
            },
            Lore: {
              type: 'list',
              value: {
                type: 'string',
                value: lore.map(line => JSON.stringify(line)),
              },
            },
          },
        },
        HideFlags: {
          type: 'int',
          value: 127,
        },
        Enchantments: {
          type: 'list',
          value: {
            type: 'compound',
            value: Object.entries(enchants).map(([id, level]) => ({
              id: {
                type: 'string',
                value: id,
              },
              lvl: {
                type: 'short',
                value: level,
              },
            })),
          },
        },
        CustomModelData: {
          type: 'int',
          value: custom_model_data
        }
      },
    },
  }
}

export const empty_slot = {
  present: false,
}
