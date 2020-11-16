import { on } from 'events'

import { pipeline, reduce } from 'streaming-iterables'

import { chunk_position, same_chunk } from '../chunk.js'
import {
  sort_by_distance,
  square_difference,
  square_symmetric_difference,
} from '../math.js'

async function load_chunk({ world }, { client, x, z }) {
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
}

function unload_chunk(state, { client, x, z }) {
  client.write('unload_chunk', {
    chunkX: x,
    chunkZ: z,
  })
}

export async function load_chunks(state, { client, events, chunks }) {
  const points = chunks.map(({ x, z }) => ({ x, y: z }))
  const sorted = sort_by_distance(
    {
      x: chunk_position(state.position.x),
      y: chunk_position(state.position.z),
    },
    points
  )
  for (const { x, y } of sorted) await load_chunk(state, { client, x, z: y })
  for (const { x, y } of sorted) events.emit('chunk_loaded', { x, z: y })
}

export function unload_chunks(state, { client, events, chunks }) {
  for (const chunk of chunks) {
    events.emit('chunk_unloaded', chunk)
    unload_chunk(state, { client, ...chunk })
  }
}

export default async function update_chunks({ client, events }) {
  events.once('state', (initial_state) =>
    pipeline(
      () => on(events, 'state'),
      reduce(async (last_state, [state]) => {
        if (!same_chunk(last_state.position, state.position)) {
          const {
            a: points_to_unload,
            b: points_to_load,
          } = square_symmetric_difference(
            {
              x: chunk_position(last_state.position.x),
              y: chunk_position(last_state.position.z),
            },
            {
              x: chunk_position(state.position.x),
              y: chunk_position(state.position.z),
            },
            state.view_distance - 1
          )

          client.write('update_view_position', {
            chunkX: chunk_position(state.position.x),
            chunkZ: chunk_position(state.position.z),
          })

          const to_unload = points_to_unload.map(({ x, y }) => ({ x, z: y }))
          unload_chunks(state, { client, events, chunks: to_unload })

          const to_load = points_to_load.map(({ x, y }) => ({ x, z: y }))
          await load_chunks(state, { client, events, chunks: to_load }) // TODO kick player on error ?
        }

        if (last_state.view_distance !== state.view_distance) {
          const chunk_point = {
            x: chunk_position(state.position.x),
            y: chunk_position(state.position.z),
          }
          const points = square_difference(
            chunk_point,
            Math.min(0, last_state.view_distance - 1),
            state.view_distance - 1
          )
          const chunks = points.map(({ x, y }) => ({ x, z: y }))

          const action =
            state.view_distance > last_state.view_distance
              ? load_chunks
              : unload_chunks

          await action(state, { client, events, chunks })
        }

        return state
      }, initial_state)
    )
  )
}
