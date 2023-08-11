import { screen_ray_intersection } from '../core/screen.js'

/** @type {import('../server').Module} */
export default {
  observe({ client, events, world }) {
    client.on('arm_animation', ({ hand }) => {
      events.once('STATE_UPDATED', state => {
        const { position } = state
        for (const [screen_id, screen] of Object.entries(world.screens)) {
          const intersect = screen_ray_intersection(screen, position)
          if (intersect) {
            const { x, y } = intersect
            events.emit('SCREEN_INTERRACTED', {
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
