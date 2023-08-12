import { performance } from 'perf_hooks'

import Anvil from 'prismarine-provider-anvil'

import { VERSION } from '../settings.js'

const AnvilWorld = Anvil.Anvil(VERSION)

export const chunk_position = value => Math.floor(value / 16)

export const chunk_index = (x, z) => `${x}:${z}`

export function unload_chunk({ client, x, z }) {
  client.write('unload_chunk', {
    chunkX: x,
    chunkZ: z,
  })
}

export function chunk_from_index(index) {
  const [x, z] = index.split(':')
  return { x: Number(x), z: Number(z) }
}

export function same_position(first_position, second_position) {
  return (
    first_position?.x === second_position?.x &&
    first_position?.y === second_position?.y &&
    first_position?.z === second_position?.z
  )
}

export function same_chunk(first_position, second_position) {
  const first_chunk_x = chunk_position(first_position.x)
  const first_chunk_z = chunk_position(first_position.z)
  const second_chunk_x = chunk_position(second_position.x)
  const second_chunk_z = chunk_position(second_position.z)

  const same_x = first_chunk_x === second_chunk_x
  const same_z = first_chunk_z === second_chunk_z

  return same_x && same_z
}

/**
 * @typedef {ReturnType<import('prismarine-block')>} BlockLoader
 * @typedef {InstanceType<BlockLoader>} Block
 */

/** @returns {Promise<Block>} */
export async function get_block(world, { x, y, z }) {
  const chunk = await world.chunks.load(chunk_position(x), chunk_position(z))

  return chunk.getBlock({ x: x % 16, y, z: z % 16 })
}

// https://github.com/tc39/proposal-weakrefs#weak-caches
function make_weak_cached(load, unload) {
  const cache = new Map()
  const cleanup = new FinalizationRegistry(key => {
    const ref = cache.get(key)
    if (ref && !ref.deref()) {
      if (cache.delete(key)) unload(key)
    }
  })

  return key => {
    const ref = cache.get(key)
    if (ref) {
      const cached = ref.deref()
      if (cached !== undefined) return cached
    }

    const fresh = load(key)
    cache.set(key, new WeakRef(fresh))
    cleanup.register(fresh, key)
    return fresh
  }
}

function fix_light(chunk) {
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 256; y++) {
        chunk.setSkyLight({ x, y, z }, 15)
        chunk.setBlockLight({ x, y, z }, 15)
      }
    }
  }
}

/** @param {Object} params
 * @param {import('minecraft-protocol').Client} params.client
 * @param {import("../server.js").World} params.world
 * @param {number} params.x
 * @param {number} params.z
 */
export async function load_chunk({ client, world, x, z }) {
  performance.mark('load_chunk_start')

  const chunk = await world.chunks.load(x, z)

  fix_light(chunk) // TODO: replace this with a proper fix

  client.write('update_light', {
    chunkX: x,
    chunkZ: z,
    trustEdges: true,
    skyLightMask: chunk.skyLightMask,
    blockLightMask: chunk.blockLightMask,
    emptySkyLightMask: 0,
    emptyBlockLightMask: 0,
    data: chunk.dumpLight(),
  })
  client.write('map_chunk', {
    x,
    z,
    groundUp: true,
    bitMap: chunk.getMask(),
    biomes: chunk.dumpBiomes(),
    ignoreOldData: true,
    heightmaps: {
      type: 'compound',
      name: '',
      value: {
        MOTION_BLOCKING: {
          type: 'longArray',
          value: new Array(36).fill([256, 256]),
        },
      },
    }, // FIXME: fake heightmap
    chunkData: chunk.dump(),
    blockEntities: [],
  })
  performance.mark('load_chunk_end')
  performance.measure('load_chunk', 'load_chunk_start', 'load_chunk_end')

  // Loading one chunk is cpu intensive, wait for next tick to avoid
  // starving the event loop for too long
  await new Promise(resolve => process.nextTick(resolve))
}

export function chunks(region_folder) {
  const provider = new AnvilWorld(region_folder)

  const load_chunk = make_weak_cached(
    key => {
      const { x, z } = chunk_from_index(key)
      return provider.load(x, z)
    },
    () => performance.mark('chunk_gc'),
  )

  return {
    load(x, z) {
      return load_chunk(chunk_index(x, z))
    },
  }
}

export function surrounding_chunks({ position, view_distance }) {
  const chunks = []
  const { x, z } = position
  const chunkX = chunk_position(x)
  const chunkZ = chunk_position(z)

  for (let dx = -view_distance; dx <= view_distance; dx++) {
    for (let dz = -view_distance; dz <= view_distance; dz++) {
      chunks.push({
        x: chunkX + dx,
        z: chunkZ + dz,
      })
    }
  }

  return chunks
}
