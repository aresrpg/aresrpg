import UUID from 'uuid-1345'
import v from 'vec3'
import minecraftData from 'minecraft-data'

import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'
import { item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }

import { BlockDigStatus } from './inventory.js'

const mcData = minecraftData(VERSION)

function create_class_stand(
  client,
  entity_id,
  { x, y, z },
  yaw,
  selectedClasse
) {
  const stand = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.armor_stand.id,
    x,
    y: y + 1,
    z,
    yaw,
    headYaw: yaw,
    pitch: 0,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  }

  const metadata = {
    entityId: entity_id,
    metadata: to_metadata('armor_stand', {
      custom_name: JSON.stringify(selectedClasse),
      is_custom_name_visible: true,
      has_no_gravity: true,
      armor_stand_flags: {
        has_arms: true,
        has_no_baseplate: true,
      },
    }),
  }

  const equipment_map = {
    main_hand: 0,
    off_hand: 1,
    boots: 2,
    leggings: 3,
    chestplate: 4,
    helmet: 5,
  }

  const equipment = {
    main_hand: { type: 'menitrass_100', count: 1 },
    helmet: { type: 'majestic_crown_of_hades', count: 1 },
    chestplate: { type: 'majestic_hades_armor', count: 1 },
    leggings: { type: 'fabulous_bottoms_of_hades', count: 1 },
    boots: { type: 'fabulous_hades_boots', count: 1 },
  }

  const entity_equipement = {
    entityId: entity_id,
    equipments: Object.keys(equipment).map(slot => ({
      slot: equipment_map[slot],
      item: item_to_slot(items[equipment[slot].type], equipment[slot].count),
    })),
  }

  client.write('spawn_entity_living', stand)
  client.write('entity_metadata', metadata)

  // crash player
  client.write('entity_equipement', entity_equipement)
}

const classes = {
  barbare: {
    entityId: null,
    text: 'Barbare',
    color: 'blue',
    item: Array.from({
      length: 6,
      0: { type: 'menitrass_100', count: 1 },
      5: { type: 'majestic_crown_of_hades', count: 1 },
      4: { type: 'majestic_hades_armor', count: 1 },
      3: { type: 'fabulous_bottoms_of_hades', count: 1 },
      2: { type: 'fabulous_hades_boots', count: 1 },
    }),
  },
  paladin: {
    entityId: null,
    text: 'Paladin',
    color: 'gold',
  },
  archer: {
    entityId: null,
    text: 'Archer',
    color: 'green',
  },
  mage: {
    entityId: null,
    text: 'Mage',
    color: 'dark_purple',
  },
}

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  const { next_entity_id } = world
  classes.barbare.entityId = next_entity_id + 1
  classes.paladin.entityId = next_entity_id + 2
  classes.archer.entityId = next_entity_id + 3
  classes.mage.entityId = next_entity_id + 4
  return {
    ...world,
    next_entity_id: next_entity_id + classes.length,
  }
}

const invId = 10
const invType = 16

function open_book({ client }) {
  client.write('open_window', {
    windowId: invId,
    inventoryType: invType,
    text: 'coucou',
  })
}

export default {
  /** @type {import('../context').Observer} */
  observe({ client, get_state }) {
    const right_click = 2
    client.on('use_entity', ({ target, mouse }) => {
      const classId = [
        classes.barbare.entityId,
        classes.paladin.entityId,
        classes.archer.entityId,
        classes.mage.entityId,
      ]

      if (classId.includes(target) && mouse === right_click) {
        console.log(classId)
        console.log('click')
        open_book({ client })
      }
    })

    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {
        const position = v(get_state().position)

        create_class_stand(
          client,
          4243,
          position.offset(0, 0, 2),
          127,
          classes.barbare
        ) // front
        create_class_stand(
          client,
          4244,
          position.offset(2, 0, 0),
          65,
          classes.paladin
        ) // left
        create_class_stand(
          client,
          4245,
          position.offset(-2, 0, 0),
          -65,
          classes.archer
        ) // right
        create_class_stand(
          client,
          4246,
          position.offset(0, 0, -2),
          0,
          classes.mage
        ) // back
      }
    })
  },
}
