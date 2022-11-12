import UUID from 'uuid-1345'
import v from 'vec3'
import minecraftData from 'minecraft-data'

import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'
import { empty_slot, item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }

import { BlockDigStatus } from './inventory.js'
const mcData = minecraftData(VERSION)

const to_slot = item =>
  item ? item_to_slot(items[item.type], item.count) : empty_slot

const classes = {
  barbare: {
    entityId: null,
    name: {
      text: 'Barbare',
      color: 'blue',
    },
    stand_item: [
      { type: 'menitrass_100', count: 1 },
      null,
      { type: 'shrek_boots', count: 1 },
      { type: 'artaen_pants', count: 1 },
      { type: 'strauss_armor', count: 1 },
      { type: 'pommo_helm', count: 1 },
    ],
  },
  paladin: {
    entityId: null,
    name: {
      text: 'Paladin',
      color: 'gold',
    },
    stand_item: [
      { type: 'nitrildin_100', count: 1 },
      null,
      { type: 'shrek_boots', count: 1 },
      { type: 'artaen_pants', count: 1 },
      { type: 'strauss_armor', count: 1 },
      { type: 'pommo_helm', count: 1 },
    ],
  },
  archer: {
    entityId: null,
    name: {
      text: 'Archer',
      color: 'green',
    },
    stand_item: [
      { type: 'svidriin_100', count: 1 },
      null,
      { type: 'shrek_boots', count: 1 },
      { type: 'artaen_pants', count: 1 },
      { type: 'strauss_armor', count: 1 },
      { type: 'pommo_helm', count: 1 },
    ],
  },
  mage: {
    entityId: null,
    name: {
      text: 'Mage',
      color: 'dark_purple',
    },
    stand_item: [
      { type: 'ulkrann_100_staff', count: 1 },
      null,
      { type: 'shrek_boots', count: 1 },
      { type: 'artaen_pants', count: 1 },
      { type: 'strauss_armor', count: 1 },
      { type: 'pommo_helm', count: 1 },
    ],
  },
}

function create_class_stand(client, { x, y, z }, yaw, selectedClass) {
  const { entityId, stand_item, name } = selectedClass
  const stand = {
    entityId,
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
    entityId,
    metadata: to_metadata('armor_stand', {
      custom_name: JSON.stringify(name),
      is_custom_name_visible: true,
      has_no_gravity: true,
      armor_stand_flags: {
        has_arms: true,
        has_no_baseplate: true,
      },
    }),
  }

  const entity_equipement = {
    entityId,
    equipments: stand_item.map(item => ({
      slot: stand_item.indexOf(item),
      item: to_slot(item),
    })),
  }

  client.write('spawn_entity_living', stand)
  client.write('entity_metadata', metadata)
  client.write('entity_equipment', entity_equipement)
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
        const { barbare, paladin, archer, mage } = classes

        create_class_stand(client, position.offset(0, 0, 2), 127, barbare) // front
        create_class_stand(client, position.offset(2, 0, 0), 65, paladin) // left
        create_class_stand(client, position.offset(-2, 0, 0), -65, archer) // right
        create_class_stand(client, position.offset(0, 0, -2), 0, mage) // back
      }
    })
  },
}
