import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import { can_interract_with_entities } from '../core/permissions.js'
import { path_position } from '../core/entity_path.js'

/** @type {import('../server').Module} */
export default {
  observe({ client, events }) {
    events.on('ENTITY_ENTER_VIEW', ({ mob, signal }) => {
      const look_at_player = player_state => {
        if (!can_interract_with_entities(player_state)) return
        const state = mob.get_state()
        const {
          position: { x, z },
        } = player_state

        const position = path_position({
          path: state.path,
          time: Date.now(),
          start_time: state.start_time,
          speed: state.speed,
        })

        const yaw = Math.floor(
          (-Math.atan2(x - position.x, z - position.z) / Math.PI) * (255 / 2),
        )

        client.write('entity_head_rotation', {
          entityId: mob.entity_id,
          headYaw: yaw,
        })
      }

      aiter(abortable(on(mob.events, 'STATE_UPDATED', { signal }))).reduce(
        (last_look_at, [{ look_at }]) => {
          if (last_look_at !== look_at) {
            if (last_look_at.player) events.off('STATE_UPDATED', look_at_player)
            if (look_at.player) events.on('STATE_UPDATED', look_at_player)
            else {
              client.write('entity_head_rotation', {
                entityId: mob.entity_id,
                headYaw: look_at.yaw,
              })
            }
          }
          return look_at
        },
      )
    })
  },
}
