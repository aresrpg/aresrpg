import UUID from 'uuid-1345'
import Items from '../../data/items.json' assert { type: 'json' }
import { Action, Context } from '../events.js'
import { direction_to_yaw_pitch, to_direction } from '../math.js'

const HOTBAR_OFFSET = 36
const Hand = {
  MAINHAND: 0,
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, dispatch, events }) {
    client.on('use_item', ({ hand }) => {
      if (hand === Hand.MAINHAND) {
        const { inventory, held_slot_index, position } = get_state()
        const slot_number = held_slot_index + HOTBAR_OFFSET
        const item = inventory[slot_number]
        const state = get_state()
        if (item && state.health > 0) {
          const { type } = item
          const itemData = Items[type]
          if (itemData.type === 'weapon' && itemData.item === 'bow') {
            dispatch(Action.SHOOT, {})
            client.write('spawn_entity', {
              entityId: 99999,
              objectUUID: UUID.v4(),
              type: 2,
              ...position,
              ...direction_to_yaw_pitch(to_direction(position.yaw, position.pitch)),
              objectData: client.id,
              velocityX: 1000,
              velocityY: 500,
              velocityZ: 0,
            })
            let t = 0
            const direction = to_direction(position.yaw, position.pitch)
            const velx = direction.x*4000
            let vely = direction.y*1000
            const velz = direction.z*4000
            const interval = setInterval(() => {
              vely -= 198
              if (t > 1) {
                clearInterval(interval)
              } else {
                client.write('rel_entity_move', {
                  entityId: 99999,
                  dX: velx,
                  dY: vely,
                  dZ: velz,
                  onGround: false
                })
                client.write('entity_velocity', {
                  entityId: 99999,
                  velocityX: velx,
                  velocityY: vely,
                  velocityZ: velz,
                })
              }
              t += 0.05
            }, 50)
          }
        }
      }
    }
  )}
}