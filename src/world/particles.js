import { on } from 'events'
import fs from 'fs'

import Vec3 from 'Vec3'
import mdata from 'minecraft-data'
import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import logger from '../logger.js'
import { Context, World } from '../events.js'
import { abortable } from '../iterator.js'

const mcData = mdata('1.16.5')
const log = logger(import.meta)
export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, Context.MOB_DAMAGE, { signal })
          // on(events, Context.MOB_DEATH, { signal }),
        )
      )
    )
      .map(([{ mob }]) => ({ mob }))
      .reduce(
        ({ lastParticle }, { mob }) => {
          const state = mob.get_state()
          const { path } = state
          const size = path.length
          const { x, y, z } = path[size - 1]
          const { height } = mob.constants
          const time = Date.now()
          world_particle(
            'block',
            world,
            Vec3([x, y + height * 0.7, z]),
            { count: 10, size: Vec3([0, 0, 0]) },
            mcData.blocksByName.redstone_block.defaultState
          )
          return {
            lastParticle: time,
          }
        },
        { lastParticle: 0 }
      )

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
  const particle = particleByName(particleName)

  log.info(particle)
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

export function particleByName(name) {
  const json = JSON.parse(
    fs.readFileSync(
      'node_modules/minecraft-data/minecraft-data/data/pc/1.16/particles.json',
      'utf8'
    )
  )
  return json.filter(particle => particle.name === name)[0]
}
