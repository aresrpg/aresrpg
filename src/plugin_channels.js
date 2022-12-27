import minecraft_data from 'minecraft-data'
import minecraft_types from 'minecraft-protocol/src/datatypes/minecraft.js'
import protodef from 'protodef'

import logger from './logger.js'
import { VERSION } from './settings.js'

const log = logger(import.meta)

const mc_data = minecraft_data(VERSION)

const BRAND_CHANNEL = 'minecraft:brand'
const DEBUG_PATH_CHANNEL = 'minecraft:debug/path'
const DEBUG_GAME_TEST_ADD_MARKER_CHANNEL =
  'minecraft:debug/game_test_add_marker'
const DEBUG_GAME_TEST_CLEAR = 'minecraft:debug/game_test_clear'

const proto = new protodef.ProtoDef()

/** @type {any} */
const { protocol } = mc_data

proto.addTypes(protocol.types)
proto.addTypes(minecraft_types)

proto.addType(BRAND_CHANNEL, 'string')

proto.addType('path_point', [
  'container',
  [
    { name: 'x', type: 'i32' },
    { name: 'y', type: 'i32' },
    { name: 'z', type: 'i32' },
    { name: 'origin_distance', type: 'f32' },
    { name: 'cost_malus', type: 'f32' },
    { name: 'visited', type: 'bool' },
    { name: 'type', type: 'i32' },
    { name: 'target_distance', type: 'f32' },
  ],
])

export const path_types = {
  BLOCKED: 0,
  OPEN: 1,
  WALKABLE: 2,
  TRAPDOOR: 3,
  FENCE: 4,
  LAVA: 5,
  WATER: 6,
  WATER_BORDER: 7,
  RAIL: 8,
  UNPASSABLE_RAIL: 9,
  DANGER_FIRE: 10,
  DAMAGE_FIRE: 11,
  DANGER_CACTUS: 12,
  DAMAGE_CACTUS: 13,
  DANGER_OTHER: 14,
  DAMAGE_OTHER: 15,
  DOOR_OPEN: 16,
  DOOR_WOOD_CLOSED: 17,
  DOOR_IRON_CLOSED: 18,
  BREACH: 19,
  LEAVES: 20,
  STICKY_HONEY: 21,
  COCOA: 22,
}

proto.addType('path', [
  'container',
  [
    { name: 'reached', type: 'bool' },
    { name: 'current_path_index', type: 'i32' },
    {
      name: 'targets',
      type: [
        'array',
        {
          countType: 'i32',
          type: 'path_point',
        },
      ],
    },
    {
      name: 'target',
      type: [
        'container',
        [
          { name: 'x', type: 'i32' },
          { name: 'y', type: 'i32' },
          { name: 'z', type: 'i32' },
        ],
      ],
    },
    {
      name: 'nodes',
      type: [
        'array',
        {
          countType: 'i32',
          type: 'path_point',
        },
      ],
    },
    {
      name: 'open_set',
      type: [
        'array',
        {
          countType: 'i32',
          type: 'path_point',
        },
      ],
    },
    {
      name: 'closed_set',
      type: [
        'array',
        {
          countType: 'i32',
          type: 'path_point',
        },
      ],
    },
  ],
])

proto.addType(DEBUG_PATH_CHANNEL, [
  'container',
  [
    { name: 'id', type: 'i32' },
    { name: 'radius', type: 'f32' },
    { name: 'path', type: 'path' },
  ],
])

proto.addType(DEBUG_GAME_TEST_ADD_MARKER_CHANNEL, [
  'container',
  [
    { name: 'location', type: 'position' },
    { name: 'color', type: 'i32' },
    { name: 'name', type: 'string' },
    { name: 'destroy_after', type: 'i32' },
  ],
])

const channels = [BRAND_CHANNEL]

export default {
  transform(action) {
    if (action.type === 'packet/custom_payload') {
      const { channel, data: raw_data } = action.payload

      if (channels.includes(channel)) {
        const { data } = proto.parsePacketBuffer(channel, raw_data)
        return {
          type: `channel/${channel}`,
          payload: data,
        }
      }
    }
    return action
  },
  reduce(state, { type, payload }) {
    if (type === `channel/${BRAND_CHANNEL}`) {
      const brand = payload
      log.info({ brand }, 'Client brand')

      return {
        ...state,
        brand,
      }
    }
    return state
  },
}

export function write_brand(client, { brand }) {
  client.write('custom_payload', {
    channel: BRAND_CHANNEL,
    data: proto.createPacketBuffer(BRAND_CHANNEL, brand),
  })
}

export function write_add_test_marker(client, marker) {
  client.write('custom_payload', {
    channel: DEBUG_GAME_TEST_ADD_MARKER_CHANNEL,
    data: proto.createPacketBuffer(DEBUG_GAME_TEST_ADD_MARKER_CHANNEL, marker),
  })
}

export function write_clear_test_markers(client) {
  client.write('custom_payload', {
    channel: DEBUG_GAME_TEST_CLEAR,
    data: [],
  })
}

export function write_path(client, path) {
  client.write('custom_payload', {
    channel: DEBUG_PATH_CHANNEL,
    data: proto.createPacketBuffer(DEBUG_PATH_CHANNEL, path),
  })
}
