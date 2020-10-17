import {
  sort_by_distance,
  square_difference,
  square_symmetric_difference,
} from '../math.js'

export async function load_chunk({ client, world, events }, { x, z }) {
  const chunk = await world.chunks.load(x, z)
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
  events.emit('chunk_loaded', { x, z })
}

export function unload_chunk({ client, events }, { x, z }) {
  client.write('unload_chunk', {
    chunkX: x,
    chunkZ: z,
  })

  events.emit('chunk_unloaded', { x, z })
}

export async function load_chunks(state, chunks) {
  const points = chunks.map(({ x, z }) => ({ x, y: z }))
  const sorted = sort_by_distance(
    { x: state.chunk.x, y: state.chunk.z },
    points
  )
  for (const { x, y } of sorted) await load_chunk(state, { x, z: y })
}

export function unload_chunks(state, chunks) {
  for (const chunk of chunks) unload_chunk(state, chunk)
}

export default function update_chunks({
  client,
  world,
  events,
  view_distance = 0,
  chunk,
}) {
  const onChunkChange = ({ last, next }) => {
    const state = { client, world, events, view_distance, chunk: next }
    unregister()
    update_chunks(state)

    const {
      a: points_to_unload,
      b: points_to_load,
    } = square_symmetric_difference(
      {
        x: last.x,
        y: last.z,
      },
      {
        x: next.x,
        y: next.z,
      },
      view_distance - 1
    )

    const to_load = points_to_load.map(({ x, y }) => ({ x, z: y }))
    load_chunks(state, to_load) // TODO kick player on error ?

    const to_unload = points_to_unload.map(({ x, y }) => ({ x, z: y }))
    unload_chunks(state, to_unload)

    client.write('update_view_position', {
      chunkX: next.x,
      chunkZ: next.z,
    })
  }

  const onSettings = ({ viewDistance: next_view_distance }) => {
    const state = {
      client,
      world,
      events,
      view_distance: next_view_distance,
      chunk,
    }
    unregister()
    update_chunks(state)

    const chunk_point = { x: chunk.x, y: chunk.z }
    const points = square_difference(
      chunk_point,
      view_distance,
      next_view_distance - 1
    )
    const chunks = points.map(({ x, y }) => ({ x, z: y }))

    const action =
      next_view_distance > view_distance ? load_chunks : unload_chunks
    action(state, chunks)
  }

  const unregister = () => {
    events.off('chunk_change', onChunkChange)
    client.off('settings', onSettings)
  }
  events.on('chunk_change', onChunkChange)
  client.on('settings', onSettings)
}
