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

export default async function setBiome({ world, sender, args }) {
  if (args.length === 3) {
    const [x, z, biomeId] = args

    const pos = {
      x: chunk_position(x),
      z: chunk_position(z),
    }

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
