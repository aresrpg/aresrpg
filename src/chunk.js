import { performance } from 'perf_hooks'

import Anvil from 'prismarine-provider-anvil'

import { version } from './settings.js'

const AnvilWorld = Anvil.Anvil(version)

export const chunk_position = (value) => Math.floor(value / 16)

export const chunk_index = (x, z) => `${x}:${z}`

export function chunk_from_index(index) {
  const [x, z] = index.split(':')
  return { x: Number(x), z: Number(z) }
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

export async function get_block(world, { x, y, z }) {
  const chunk = await world.chunks.load(chunk_position(x), chunk_position(z))

  return chunk.getBlock({ x: x % 16, y, z: z % 16 })
}

// https://github.com/tc39/proposal-weakrefs#weak-caches
function make_weak_cached(load, unload) {
  const cache = new Map()
  const cleanup = new FinalizationRegistry((key) => {
    const ref = cache.get(key)
    if (ref && !ref.deref()) {
      if (cache.delete(key)) unload(key)
    }
  })

  return (key) => {
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

export function chunks(region_folder) {
  const provider = new AnvilWorld(region_folder)

  const load_chunk = make_weak_cached(
    (key) => {
      const { x, z } = chunk_from_index(key)
      return provider.load(x, z)
    },
    () => performance.mark('chunk_gc')
  )

  return {
    load(x, z) {
      return load_chunk(chunk_index(x, z))
    },
  }
}
