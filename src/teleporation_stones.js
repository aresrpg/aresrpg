import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import { version } from './settings.js'
import { chunk_position } from './chunk.js'
import { empty_slot } from './items.js'
const mcData = minecraftData(version)

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

const lines = [
  (name) => [
    { text: '|| ', obfuscated: true, color: 'black' },
    { text: name, color: 'dark_green', obfuscated: false },
    { text: ' ||', obfuscated: true, color: 'black' },
  ],
  (_name) => [
    { text: '>>', bold: true, color: 'dark_aqua' },
    { text: ' Pierre de téléportation', color: 'gold' },
    { text: ' <<', bold: true, color: 'dark_aqua' },
  ],
]

const line_offset = 0.3

export function register_teleportation_stones(world) {
  return {
    ...world,
    lastEntityId:
      world.lastEntityId + world.teleportation_stones.length * lines.length * 2,
    lastWindowId: world.lastWindowId + world.teleportation_stones.length,
    teleportation_stones: world.teleportation_stones.map(
      (stone, stone_index) => ({
        ...stone,
        window_id: world.lastWindowId + stone_index,
        entity_ids: Array.from({ length: lines.length * 2 }).map(
          (_, index) =>
            world.lastEntityId + stone_index * lines.length * 2 + index
        ),
      })
    ),
  }
}

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

// TODO: Create a chat component type ?
/**
 * create an armor_stand to create a line
 * with its display name
 * @param {any} client
 * @param {number} entity_id
 * @param {Position} position
 * @param {any} display_name
 */
function create_armor_stand(client, entity_id, { x, y, z }, display_name) {
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.armor_stand.id,
    x: x + 0.5,
    y,
    z: z + 0.5,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  }

  const metadata = {
    entityId: entity_id,
    metadata: [
      // TODO: fix magic number
      { key: 0, type: 0, value: 0x20 },
      {
        key: 2,
        value: JSON.stringify(display_name),
        type: 5,
      },
      {
        key: 3,
        type: 7,
        value: true,
      },
      { key: 14, type: 0, value: 0x10 },
    ],
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
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
    // TODO: fix magic number
    metadata: [
      { key: 0, type: 0, value: 0x20 },
      {
        key: 3,
        type: 7,
        value: true,
      },
      { key: 15, type: 1, value: 1 },
    ],
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
        text: line(name),
        entity_ids: entity_ids.slice(line_index * 2, (line_index + 1) * 2),
      }))
    }

    const spawn_entities = ({
      position,
      text,
      entity_ids: [line_id, hitbox_id],
    }) => {
      create_armor_stand(client, line_id, position, text)
      create_slime(client, hitbox_id, position)
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

function on_use_entity({ client, world }) {
  return ({ target, mouse, hand }) => {
    const current_teleportation_stone = world.teleportation_stones.find(
      (stone) => stone.entity_ids.includes(target)
    )
    if (current_teleportation_stone && hand === 1 && mouse === 2) {
      const stone_to_item = ({ name }) => ({
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
      })
      const items = Array.from({
        ...world.teleportation_stones.filter(
          (stone) => stone !== current_teleportation_stone
        ),
        // TODO: inventory size depending on the number of teleportation stones
        length: 18,
      }).map((stone) => (stone ? stone_to_item(stone) : empty_slot))

      client.write('open_window', {
        windowId: current_teleportation_stone.window_id,
        // TODO: MAGIC NUMBERS EVERYWHERE
        // TODO: inventory size depending on the number of teleportation stones
        inventoryType: 1,
        windowTitle: JSON.stringify({ text: 'Pierre de téléportation' }),
      })
      client.write('window_items', {
        windowId: current_teleportation_stone.window_id,
        items,
      })
    }
  }
}

function on_window_click({ world, client, position }) {
  return ({ windowId, action, slot }) => {
    const current_teleportation_stone = world.teleportation_stones.find(
      ({ window_id: stone_window_id }) => stone_window_id === windowId
    )

    if (current_teleportation_stone) {
      const available_teleportations_stones = Array.from({
        ...world.teleportation_stones.filter(
          (stone) => stone !== current_teleportation_stone
        ),
        // TODO: inventory size depending on the number of teleportation stones
        length: 18,
      })
      if (slot >= 0 && slot < available_teleportations_stones.length) {
        client.write('transaction', { windowId, action, accepted: false })
        if (available_teleportations_stones[slot]) {
          client.write('close_window', { windowId })
          client.write('position', {
            ...position,
            ...available_teleportations_stones[slot].position,
          })
        }
        return
      }
      // TODO: cancel the window_click by resending the window_items & some set_slot packets
      client.write('transaction', { windowId, action, accepted: true })
    }
  }
}

export function teleportation_stones(state) {
  const { events, client } = state
  events.on('chunk_loaded', on_chunk_loaded(state))
  events.on('chunk_unloaded', on_chunk_unloaded(state))

  client.on('use_entity', on_use_entity(state))
  client.on('window_click', on_window_click(state))
}
