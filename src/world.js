import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { EventEmitter } from 'events'

import Entities from '../data/entities.json' assert { type: 'json' }
import mobs from '../world/floor1/mobs.json' assert { type: 'json' }
import traders from '../world/floor1/traders.json' assert { type: 'json' }
import teleportation_stones from '../world/floor1/teleportation_stones.json' assert { type: 'json' }

import logger from './logger.js'
import { chunks } from './core/chunk.js'

/** @typedef {Readonly<typeof initial_world>} InitialWorld */
/** @typedef {Readonly<ReturnType<typeof initialize_world>>} LivingWorld */

const log = logger(import.meta)

const world_folder = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'world',
)

export const Worlds = {
  floor1: {
    spawn_position: { x: 469.5, y: 162, z: 646.5, yaw: 25, pitch: 0 },
    chunks: chunks(join(world_folder, 'floor1', 'region')),
    mob_positions: mobs.filter(({ type }) => Entities[type]),
    traders,
    teleportation_stones,
  },
}

const initial_world = {
  ...Worlds.floor1,
  next_entity_id: 1,
  next_window_id: 1, // 0 is the player inventory
  screens: {},
  mobs_by_chunk: new Map(),
}

/** @param {import("./mobs").Mob[]} mobs */
function initialize_world(mobs) {
  const { next_entity_id } = initial_world
  return {
    ...initial_world,
    mobs,
    events: new EventEmitter(),
    mob_by_entity_id(id) {
      if (id >= next_entity_id && id <= next_entity_id + mobs.length)
        return mobs[id - next_entity_id]
      else return null
    },
    next_entity_id: initial_world.next_entity_id + mobs.length,
  }
}

/** @param {import("./server").WorldReducers} initial_world_reducers */
export function create_world(initial_world_reducers) {
  /** @param {import("./mobs").CreateMob} create_mob */
  return create_mob => {
    const mobs = initial_world.mob_positions.map(create_mob(initial_world))

    const missing_entities = [
      ...new Set(mobs.map(({ type }) => type).filter(type => !Entities[type])),
    ]

    /** @type {import("./server").World} */
    // @ts-ignore I really don't know how to fix this circular reference
    const world = initial_world_reducers.reduce(
      (reduced_world, fn) => fn(reduced_world),
      initialize_world(mobs),
    )

    mobs.forEach(mob => mob.wake(world))

    log.info(
      {
        world: 'floor1',
        mobs: world.mob_positions.length,
        teleportation_stones: world.teleportation_stones.length,
        missing_entities,
      },
      'World loaded',
    )

    return world
  }
}
