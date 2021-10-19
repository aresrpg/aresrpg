import { on } from 'events'

import { aiter } from 'iterator-helper'

import { Context, Mob } from '../events.js'
import { abortable } from '../iterator.js'

import { path_position } from './path.js'

export default {
  observe({ client, events }) {
    events.on(Context.MOB_SPAWNED, ({ mob, signal }) => {
      const look_at_player = ({ position: { x, z } }) => {
        const state = mob.get_state()

        const position = path_position({
          path: state.path,
          time: Date.now(),
          start_time: state.start_time,
          speed: state.speed,
        })

        const yaw = Math.floor(
          (-Math.atan2(x - position.x, z - position.z) / Math.PI) * (255 / 2)
        )

        client.write('entity_head_rotation', {
          entityId: mob.entity_id,
          headYaw: yaw,
        })
      }

      aiter(abortable(on(mob.events, Mob.STATE, { signal }))).reduce(
        (last_look_at, [{ look_at }]) => {
          if (last_look_at !== look_at) {
            if (last_look_at.player) events.off(Context.STATE, look_at_player)
            if (look_at.player) events.on(Context.STATE, look_at_player)
            else {
              client.write('entity_head_rotation', {
                entityId: mob.entity_id,
                headYaw: look_at.yaw,
              })
            }
          }
          return look_at
        }
      )
    })
  },
}
