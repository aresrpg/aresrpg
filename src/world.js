import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Entities from '../data/entities.json' assert { type: 'json' }
import mobs from '../world/floor1/mobs.json' assert { type: 'json' }
import traders from '../world/floor1/traders.json' assert { type: 'json' }
import platform_positions from '../world/floor1/platforms.json' assert { type: 'json' }
import teleportation_stones from '../world/floor1/teleportation_stones.json' assert { type: 'json' }

import logger from './logger.js'
import { chunks } from './chunk.js'

const log = logger(import.meta)

const world_folder = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'world'
)

const missing_entities = [
  ...new Set(mobs.map(({ type }) => type).filter(type => !Entities[type])),
]

export const floor1 = {
  spawn_position: { x: 469.5, y: 162, z: 646.5, yaw: 25, pitch: 0 },
  chunks: chunks(join(world_folder, 'floor1', 'region')),
  mob_positions: mobs.filter(({ type }) => Entities[type]),
  traders,
  platform_positions,
  teleportation_stones,
}

log.info(
  {
    world: 'floor1',
    mobs: floor1.mob_positions.length,
    teleportation_stones: floor1.teleportation_stones.length,
    missing_entities,
  },
  'World loaded'
)
