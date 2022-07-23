import Vec3 from 'Vec3'
import mdata from 'minecraft-data'

import { World } from '../events.js'
const mcData = mdata('1.16.5')
export default {
  observe({ client, get_state, world, dispatch }) {
    const on_particle = options => client.write('world_particles', options)

    world.events.on(World.PARTICLES, on_particle)

    client.once('end', () => {
      world.events.off(World.PARTICLES, on_particle)
    })
  },
}
export function world_particle(
  particleName,
  world,
  position,
  { size = Vec3([1, 1, 1]), count = 1 } = {},
  blockStateId = null
) {
  const particle = mcData.particlesByName[particleName]
  const options = {
    particleId: particle.id,
    longDistance: true,
    x: position.x,
    y: position.y,
    z: position.z,
    offsetX: size.x,
    offsetY: size.y,
    offsetZ: size.z,
    particleData: 1.0, // maxspeed
    particles: count,
    data: {
      blockState: blockStateId,
    },
  }
  if (blockStateId == null) options.data = null
  world.events.emit(World.PARTICLES, options)
}
