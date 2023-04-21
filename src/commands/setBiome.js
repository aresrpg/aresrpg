import { performance } from 'perf_hooks'

import { client_chat_msg } from '../chat.js'
import { chunk_position } from '../chunk.js'

import { chunkPosition, integer, literal } from './declare_options.js'
import { write_error } from './commands.js'

export const setBiome_nodes = [
  literal({
    value: 'setBiome',
    flags: {
      has_command: true,
    },
    children: [
      chunkPosition({
        name: 'position',
        properties: undefined,
        flags: {
          has_command: true,
        },
        children: [
          integer({
            name: 'biomeId',
            flags: {
              has_command: true,
            },
          }),
        ],
      }),
    ],
  }),
]

function updateChunkBiome({ client, chunk, position, biomeId }) {
  const biomes = chunk.dumpBiomes()
  const { x, z } = position

  // update the biome foreach block in the chunk
  biomes.forEach((value, index, array) => {
    array[index] = biomeId
  })

  client.write('map_chunk', {
    x,
    z,
    groundUp: true,
    bitMap: chunk.getMask(),
    biomes,
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
}

function positionToChunk(position) {
  return {
    x: chunk_position(position.x),
    z: chunk_position(position.z),
  }
}

function toInt(coord) {
  return Number(coord.split('~')[1])
}

function handleShortcut({ position, get_state }) {
  const { x, z } = position

  if (isNaN(x) || isNaN(z)) {
    const { position } = get_state()

    position.x = toInt(x) + position.x
    position.z = toInt(z) + position.z

    return positionToChunk(position)
  }
  return positionToChunk(position)
}

export default async function setBiome({ world, sender, args, get_state }) {
  const [x, z, biomeId] = args

  if (args.length === 3 && !isNaN(biomeId)) {
    const pos = handleShortcut({ position: { x, z }, get_state })
    const chunk = await world.chunks.load(pos.x, pos.z)

    updateChunkBiome({
      client: sender,
      chunk,
      position: pos,
      biomeId,
    })

    client_chat_msg({
      client: sender,
      message: [
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' updated the biome at', color: 'aqua' },
        { text: ` ${x} ${z}`, color: 'green' },
        { text: ' !', color: 'aqua' },
      ],
    })
    return
  }
  write_error({ sender })
}
