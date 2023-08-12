import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import Nbt from 'prismarine-nbt'

import { VERSION } from '../settings.js'
import { chunk_position } from '../core/chunk.js'
import { empty_slot } from '../core/items.js'
import { create_armor_stand } from '../core/armor_stand.js'
import { to_metadata } from '../core/entity_metadata.js'
import { can_use_teleportation_stone } from '../core/permissions.js'
import { lines } from '../world/register_teleportation_stones.js'

const mcData = minecraftData(VERSION)

// TODO: export that outside, but where ?
const CURSOR = { windowId: -1, slot: -1 }

const GENERIC_9X2_INVENTORY_TYPE = 1
const GENERIC_9X2_INVENTORY_SIZE = 18

const line_offset = 0.3

/**
 * get all the teleportation stones inside of the chunk
 * @param {any} world
 * @param {number} chunk_x
 * @param {number} chunk_z
 * @return {import("../world/register_teleportation_stones").TeleportationStone[]} teleportation_stones
 */
function teleportation_stones_in_chunk(world, chunk_x, chunk_z) {
  return world.teleportation_stones.filter(
    ({ position: { x, z } }) =>
      chunk_position(x) === chunk_x && chunk_position(z) === chunk_z,
  )
}

/**
 * create a slime which will be used as a button hitbox
 * @param {any} client
 * @param {number} entity_id
 * @param {import("../types").SimplePosition} position
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
        ({ entity_ids }) => entity_ids,
      ),
    })
  }
}

function stone_to_item({ name }) {
  return {
    present: true,
    itemId: mcData.itemsByName.nether_star.id,
    itemCount: 1,
    nbtData: Nbt.comp({
      display: Nbt.comp({
        Name: Nbt.string(JSON.stringify({ text: name })),
      }),
    }),
  }
}

function on_use_entity({ client, world, get_state }) {
  return ({ target, mouse, hand }) => {
    if (can_use_teleportation_stone(get_state())) {
      const current_teleportation_stone = world.teleportation_stones.find(
        stone => stone.entity_ids.includes(target),
      )
      if (current_teleportation_stone && hand === 1 && mouse === 2) {
        const items = Array.from({
          ...world.teleportation_stones.filter(
            stone => stone !== current_teleportation_stone,
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
}

function on_window_click({ world, client, dispatch, get_state }) {
  return ({ windowId, slot }) => {
    const current_teleportation_stone = world.teleportation_stones.find(
      ({ window_id: stone_window_id }) => stone_window_id === windowId,
    )

    if (current_teleportation_stone) {
      const available_teleportations_stones = Array.from({
        ...world.teleportation_stones.filter(
          stone => stone !== current_teleportation_stone,
        ),
        // TODO: inventory size depending on the number of teleportation stones
        length: GENERIC_9X2_INVENTORY_SIZE,
      })
      if (slot >= 0 && slot < available_teleportations_stones.length) {
        if (available_teleportations_stones[slot]) {
          client.write('close_window', { windowId })
          dispatch(
            'TELEPORT_TO',
            available_teleportations_stones[slot].position,
          )
        }
      }
      client.write('window_items', {
        windowId: current_teleportation_stone.window_id,
        items: [
          ...available_teleportations_stones.map(stone =>
            stone ? stone_to_item(stone) : empty_slot,
          ),
        ],
      })
      client.write('set_slot', { ...CURSOR, item: empty_slot })
    }
  }
}

/** @type {import("../server").Module} */
export default {
  name: 'player_teleportation_stones',
  observe(context) {
    const { events, client } = context
    events.on('CHUNK_LOADED', on_chunk_loaded(context))
    events.on('CHUNK_UNLOADED', on_chunk_unloaded(context))

    client.on('use_entity', on_use_entity(context))
    client.on('window_click', on_window_click(context))
  },
}
