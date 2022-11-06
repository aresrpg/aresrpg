import UUID from 'uuid-1345'
import Vec3 from 'vec3'

import { VERSION, PLAYER_ENTITY_ID } from '../settings.js'

import { create_screen_canvas, spawn_screen, update_screen } from './screen.js'
import { BlockDigStatus } from './inventory.js'
import minecraftData from 'minecraft-data'
import v from 'vec3'
import { to_metadata } from '../entity_metadata.js'
import { empty_slot, item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }


const mcData = minecraftData(VERSION)



function create_armor_stand(client, entity_id, { x, y, z }, yaw) {
  const classes = {
    barbare: {
      text: "Barbare",
      color: 'blue',
      item: Array.from({
        length: 6,
        0: { type: 'menitrass_100', count: 1 },
        5: { type: 'majestic_crown_of_hades', count: 1 },
        4: { type: 'majestic_hades_armor', count: 1 },
        3: { type: 'fabulous_bottoms_of_hades', count: 1 },
        2: { type: 'fabulous_hades_boots', count: 1 },
      })
    },
    paladin: {
      text: "Paladin",
      color: 'gold'
    },
    archer: {
      text: "Archer",
      color: 'green'
    },
    mage: {
      text: "Mage",
      color: 'purple'
    },
  }
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.armor_stand.id,
    x,
    y: y + 1,
    z,
    yaw: yaw,
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
      custom_name: JSON.stringify(
        classes.barbare
      ),
      is_custom_name_visible: true,
      armor_stand_flags: {
        has_arms: true,
        has_no_baseplate: true,
      },
    }),
  }

  const to_slot = item =>
     item ? item_to_slot(items[item.type], item.count) : empty_slot

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
    equipments: Object.keys(equipment).map((slot) => ({
      slot: equipment_map[slot],
      item: item_to_slot(
        items[equipment[slot].type],
        equipment[slot].count
      ),
    })),
  }
  
  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
  client.write('entity_equipement', entity_equipement)
}

function create_player(client, entity_id, { x, y, z }, yaw) {
  client.write('named_entity_spawn', {
    entityId: entity_id,
    playerUUID: client.uuid,
    x,
    y,
    z,
    yaw,
    pitch: 0,
  })
}

const classId = [
  4243,
  4344,
  4345,
  4346,
]
const invId = 10
const invType = 16

function open_book({ client }) {

  client.write('open_window', {
    windowId: invId,
    inventoryType: invType,
    text: "coucou",
  })
}

export default {
  /** @type {import('../context').Observer} */
  observe({ client, get_state }) {
    const right_click = 2
    client.on('use_entity', ({ target, mouse, sneaking}) => {

      if (classId.includes(target) && mouse === right_click && sneaking === false) {
        console.log('click');
        open_book({ client })
      }

    })

    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {

        const { position } = get_state()
        const direction = v(position)
  
        create_armor_stand (client, 4243, direction.offset(0,0,2), 127) // front
        create_armor_stand (client, 4244, direction.offset(2,0,0) , 65) // left
        create_armor_stand (client, 4245, direction.offset(-2,0,0) , -65) // right
        create_armor_stand (client, 4246, direction.offset(0,0,-2) , 0) // back
        
      }
    })
  },
}


    // const armor_id = 4242

    /*
    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {
        console.log('Drop')
        const { position } = get_state()
        create_armor_stand(client, armor_id, position)
        client.write('set_passengers', {
          entityId: armor_id,
          passengers: [PLAYER_ENTITY_ID],
        })

        const direction = to_direction(position.yaw, 0)

        if (Math.abs(direction.x) > Math.abs(direction.z)) {
          direction.z = 0
        } else {
          direction.x = 0
        }

        direction.normalize()

        const up = Vec3([0, 1, 0])
        const right = direction.cross(up)

        console.log("Right", right)
        const width = 4

        const screen_positon = direction
          .scaled(5)
          .add(position)
          .add(Vec3([0, 4, 0]))
          .add(right.scaled(-width))

        const { canvas } = create_screen_canvas(world.screens.right)

        const ctx = canvas.getContext('2d')
        ctx.strokeStyle = 'blue'
        ctx.lineWidth = 2
        ctx.strokeRect(4, 4, 120, 120)
        ctx.strokeRect(4, 4 + 128, 120, 120)
        ctx.strokeRect(4, 4 + 128 * 2, 120, 120)
        ctx.strokeRect(4, 4 + 128 * 3, 120, 120)

        const { canvas: canvas2 } = create_screen_canvas(world.screens.player_screen)

        const ctx2 = canvas2.getContext('2d')
        ctx2.strokeStyle = 'red'
        ctx2.lineWidth = 2
        ctx2.strokeRect(4, 4, 128 * 5 - 8 , 128 * 4 - 8)

        spawn_screen(
          { client, world },
          {
            screen_id: 'right',
            position: screen_positon,
            direction: right.clone().add(direction.scaled(0.5)),
          }
        )

        spawn_screen(
          { client, world },
          {
            screen_id: 'right2',
            position: screen_positon,
            direction: right.clone().add(direction.scaled(0.5)),
          }
        )

        update_screen(
          { client, world },
          { screen_id: 'right', new_canvas: canvas, old_canvas: null }
        )

        create_player(client, 4243, screen_positon.clone().add(right.scaled(2)).offset(0, -2.5, 0), -position.yaw)

        spawn_screen(
          { client, world },
          {
            screen_id: 'left',
            position: screen_positon.clone().add(right.scaled(3)),
            direction: right.clone().add(direction.scaled(-0.5)),
          }
        )

        update_screen(
          { client, world },
          { screen_id: 'left', new_canvas: canvas, old_canvas: null }
        )

        spawn_screen(
          { client, world },
          {
            screen_id: 'player_screen',
            position: screen_positon.clone().add(right.scaled(4)),
            direction: right,
          }
        )

        console.log("Right", right)

        update_screen(
          { client, world },
          { screen_id: 'player_screen', new_canvas: canvas2, old_canvas: null }
        )
      }
    })
    
    client.on('steer_vehicle', ({ jump }) => {
      if (jump === 0x2 ) {
        console.log('Close menu')
        client.write('entity_destroy', {
          entityIds: [armor_id],
        })
      }
    })*/
  

