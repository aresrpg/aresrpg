import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'

import { VERSION } from '../settings.js'
import { chunk_position } from '../chunk.js'
import { PlayerEvent, PlayerAction } from '../events.js'
import { empty_slot, item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }
import { create_armor_stand } from '../armor_stand.js'
import { to_metadata } from '../entity_metadata.js'
import { distance2d_squared } from '../math.js'

const mcData = minecraftData(VERSION)

// TODO: export that outside, but where ?
const CURSOR = { windowId: -1, slot: -1 }

const GENERIC_9X2_INVENTORY_TYPE = 1
const GENERIC_9X2_INVENTORY_SIZE = 18

// TODO: move the Position type elsewhere
/**
 * @typedef {Object} Position
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} TeleportationStone
 * @property {string} name - the teleportation stone name
 * @property {Position} position - where the teleportation stone will be displayed
 * @property {number} window_id - the entity_ids of the entities used to display everything
 * @property {number[]} entity_ids - the entity_ids of the entities used to display everything
 */

// TODO: should be made configurable, or should at least vary depending on the user's language
const lines = [
  ({ name }) => [
    { text: '|| ', obfuscated: true, color: 'black' },
    { text: name, color: 'dark_green', obfuscated: false },
    { text: ' ||', obfuscated: true, color: 'black' },
  ],
  () => [
    { text: '>>', bold: true, color: 'dark_aqua' },
    { text: ' Pierre de téléportation', color: 'gold' },
    { text: ' <<', bold: true, color: 'dark_aqua' },
  ],
]

const line_offset = 0.3

/**
 * get all the teleportation stones inside of the chunk
 * @param {any} world
 * @param {number} chunk_x
 * @param {number} chunk_z
 * @return {TeleportationStone[]} teleportation_stones
 */
function teleportation_stones_in_chunk(world, chunk_x, chunk_z) {
  return world.teleportation_stones.filter(
    ({ position: { x, z } }) =>
      chunk_position(x) === chunk_x && chunk_position(z) === chunk_z
  )
}

/**
 * Return the closest teleportation stone from the player
 * @param {*} world
 * @param {*} player_pos_x
 * @param {*} player_pos_y
 * @returns {stones} name of the teleportation stone
 */
const PLAYER_ZONE_DISTANCE = 30
export function closest_stone(world, player_position) {
  const stones = world.teleportation_stones
  return stones.find(
    stone =>
      Math.sqrt(distance2d_squared(stone.position, player_position)) <=
      PLAYER_ZONE_DISTANCE
  )
}

/**
 * create a slime which will be used as a button hitbox
 * @param {any} client
 * @param {number} entity_id
 * @param {Position} position
 */
function create_slime(client, entity_id, { x, y, z }) {
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.slime.id,
    x: x + 0.5,
    y,
    z: z + 0.5,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocityX: 400,
    velocityY: 400,
    velocityZ: 400,
  }

  const metadata = {
    entityId: entity_id,
    metadata: to_metadata('slime', {
      entity_flags: { is_invisible: true },
      size: 1,
    }),
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
}

function on_chunk_loaded({ world, client }) {
  return ({ x, z }) => {
    const prepare_line_entities = ({
      entity_ids,
      name,
      position: { x, y, z },
    }) => {
      return lines.map((line, line_index) => ({
        position: { x, y: y + line_index * line_offset, z },
        text: line({ name }),
        entity_ids: entity_ids.slice(line_index * 2, (line_index + 1) * 2),
      }))
    }

    const spawn_entities = ({
      position: { x, y, z },
      text,
      entity_ids: [line_id, hitbox_id],
    }) => {
      create_armor_stand(client, line_id, { x: x + 0.5, y, z: z + 0.5 }, text)
      create_slime(client, hitbox_id, { x, y, z })
      client.write('set_passengers', {
        entityId: line_id,
        passengers: [hitbox_id],
      })
    }

    teleportation_stones_in_chunk(world, x, z)
      .flatMap(prepare_line_entities)
      .forEach(spawn_entities)
  }
}

function on_chunk_unloaded({ client, world }) {
  return ({ x, z }) => {
    client.write('entity_destroy', {
      entityIds: teleportation_stones_in_chunk(world, x, z).flatMap(
        ({ entity_ids }) => entity_ids
      ),
    })
  }
}

function stone_to_item({ name }) {
  return {
    present: true,
    itemId: mcData.itemsByName.nether_star.id,
    itemCount: 1,
    nbtData: {
      type: 'compound',
      name: 'tag',
      value: {
        display: {
          type: 'compound',
          value: {
            Name: {
              type: 'string',
              value: JSON.stringify({ text: name }),
            },
          },
        },
      },
    },
  }
}

function on_use_entity({ client, world }) {
  return ({ target, mouse, hand }) => {
    const current_teleportation_stone = world.teleportation_stones.find(stone =>
      stone.entity_ids.includes(target)
    )
    if (current_teleportation_stone && hand === 1 && mouse === 2) {
      const items = Array.from({
        ...world.teleportation_stones.filter(
          stone => stone !== current_teleportation_stone
        ),
        // TODO: inventory size depending on the number of teleportation stones
        length: GENERIC_9X2_INVENTORY_SIZE,
      }).map(stone => (stone ? stone_to_item(stone) : empty_slot))

      client.write('open_window', {
        windowId: current_teleportation_stone.window_id,
        inventoryType: GENERIC_9X2_INVENTORY_TYPE,
        windowTitle: JSON.stringify({ text: 'Pierre de téléportation' }),
      })
      client.write('window_items', {
        windowId: current_teleportation_stone.window_id,
        items,
      })
    }
  }
}

function on_window_click({ world, client, dispatch, get_state }) {
  return ({ windowId, slot }) => {
    const current_teleportation_stone = world.teleportation_stones.find(
      ({ window_id: stone_window_id }) => stone_window_id === windowId
    )

    if (current_teleportation_stone) {
      const available_teleportations_stones = Array.from({
        ...world.teleportation_stones.filter(
          stone => stone !== current_teleportation_stone
        ),
        // TODO: inventory size depending on the number of teleportation stones
        length: GENERIC_9X2_INVENTORY_SIZE,
      })
      if (slot >= 0 && slot < available_teleportations_stones.length) {
        if (available_teleportations_stones[slot]) {
          client.write('close_window', { windowId })
          dispatch(
            PlayerAction.TELEPORT_TO,
            available_teleportations_stones[slot].position
          )
        }
      }
      const { inventory } = get_state()
      client.write('window_items', {
        windowId: current_teleportation_stone.window_id,
        items: [
          ...available_teleportations_stones.map(stone =>
            stone ? stone_to_item(stone) : empty_slot
          ),
          ...inventory
            .slice(9, 45)
            .map(item =>
              item ? item_to_slot(items[item.type], item.count) : empty_slot
            ),
        ],
      })
      client.write('set_slot', { ...CURSOR, item: empty_slot })
    }
  }
}

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  return {
    ...world,
    next_entity_id:
      world.next_entity_id +
      world.teleportation_stones.length * lines.length * 2,
    next_window_id: world.next_window_id + world.teleportation_stones.length,
    /** @type {TeleportationStone[]} */
    teleportation_stones: world.teleportation_stones.map(
      (stone, stone_index) => ({
        ...stone,
        window_id: world.next_window_id + stone_index,
        entity_ids: Array.from({ length: lines.length * 2 }).map(
          (_, index) =>
            world.next_entity_id + stone_index * lines.length * 2 + index
        ),
      })
    ),
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { events, client } = context
    events.on(PlayerEvent.CHUNK_LOADED, on_chunk_loaded(context))
    events.on(PlayerEvent.CHUNK_UNLOADED, on_chunk_unloaded(context))

    client.on('use_entity', on_use_entity(context))
    client.on('window_click', on_window_click(context))
  },
}
