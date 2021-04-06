import { on } from 'events'

import { aiter } from 'iterator-helper'

export default {
  observe({ client, world }) {
    for (const mob of world.mobs.all) {
      aiter(on(mob.events, 'state')).reduce((last_look_at, [{ look_at }]) => {
        if (last_look_at !== look_at) {
          client.write('entity_head_rotation', {
            entityId: mob.entity_id,
            headYaw: look_at.yaw,
          })
        }
        return look_at
      })
    }
  },
}
