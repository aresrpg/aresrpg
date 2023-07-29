import minecraft_data from 'minecraft-data'

import { VERSION } from '../settings.js'

import customBiomes from './customBiomes.json' assert { type: 'json' }
const { loginPacket } = minecraft_data(VERSION)

export const overworld = {
  name: '',
  type: 'compound',
  value: {
    piglin_safe: {
      type: 'byte',
      value: 0,
    },
    natural: {
      type: 'byte',
      value: 1,
    },
    ambient_light: {
      type: 'float',
      value: 0,
    },
    infiniburn: {
      type: 'string',
      value: 'minecraft:infiniburn_overworld',
    },
    respawn_anchor_works: {
      type: 'byte',
      value: 0,
    },
    has_skylight: {
      type: 'byte',
      value: 1,
    },
    bed_works: {
      type: 'byte',
      value: 1,
    },
    has_raids: {
      type: 'byte',
      value: 1,
    },
    logical_height: {
      type: 'int',
      value: 256,
    },
    ultrawarm: {
      type: 'byte',
      value: 0,
    },
    has_ceiling: {
      type: 'byte',
      value: 0,
    },
    coordinate_scale: {
      type: 'double',
      value: 1,
    },
    effects: {
      type: 'string',
      value: 'minecraft:overworld',
    },
  },
}

/** @type {any} */
const { dimensionCodec } = loginPacket

// Add custom biomes to existing ones
customBiomes.data.forEach(biome => {
  dimensionCodec.value['minecraft:worldgen/biome'].value.value.value.value.push(
    biome,
  )
})

export const dimension_codec = {
  type: 'compound',
  name: '',
  value: {
    'minecraft:dimension_type': {
      type: 'compound',
      value: {
        type: {
          type: 'string',
          value: 'minecraft:dimension_type',
        },
        value: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                name: {
                  type: 'string',
                  value: 'minecraft:overworld',
                },
                id: {
                  type: 'int',
                  value: 0,
                },
                element: overworld,
              },
            ],
          },
        },
      },
    },
    'minecraft:worldgen/biome':
      dimensionCodec.value['minecraft:worldgen/biome'],
  },
}
