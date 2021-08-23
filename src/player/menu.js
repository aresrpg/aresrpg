import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import Vec3 from 'vec3'

import { version } from '../settings.js'
import { PLAYER_ENTITY_ID } from '../index.js'
import { to_direction } from '../math.js'

import { create_screen_canvas, spawn_screen, update_screen } from './screen.js'
import { BlockDigStatus } from './inventory.js'
const mc_data = minecraftData(version)

function create_armor_stand(client, entity_id, { x, y, z }) {
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mc_data.entitiesByName.armor_stand.id,
    x,
    y: y + 0.35,
    z,
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
      { key: 14, type: 0, value: 0x10 },
    ],
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
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

export default {
  /** @type {import('../index.js').Observer} */
  observe({ client, get_state, world }) {
    const armor_id = 4242

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
        ctx.strokeStyle = 'yellow'
        ctx.lineWidth = 2
        ctx.strokeRect(4, 4, 120, 120)
        ctx.strokeRect(4, 4 + 128, 120, 120)
        ctx.strokeRect(4, 4 + 128 * 2, 120, 120)
        ctx.strokeRect(4, 4 + 128 * 3, 120, 120)

        const { canvas: canvas2 } = create_screen_canvas(world.screens.player_screen)

        const ctx2 = canvas2.getContext('2d')
        ctx2.strokeStyle = 'yellow'
        ctx2.lineWidth = 2
        ctx2.strokeRect(44, 4, 128 * 5 - 48, 128 * 4 - 8)

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
          },
          true
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
      if (jump === 0x2) {
        console.log('Close menu')
        client.write('entity_destroy', {
          entityIds: [armor_id],
        })
      }
    })
  },
}
