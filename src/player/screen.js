import { PlayerEvent } from '../events.js'
import { screen_ray_intersection } from '../screen.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world }) {
    client.on('arm_animation', ({ hand }) => {
      events.once(PlayerEvent.STATE_UPDATED, state => {
        const { position } = state
        for (const [screen_id, screen] of Object.entries(world.screens)) {
          const intersect = screen_ray_intersection(screen, position)
          if (intersect) {
            const { x, y } = intersect
            events.emit(PlayerEvent.SCREEN_INTERRACTED, {
              x,
              y,
              screen_id,
              hand,
            })
          }
        }
      })
    })
  },
}
