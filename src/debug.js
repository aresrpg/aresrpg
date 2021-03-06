import { PassThrough, Readable } from 'stream'

import fastify from 'fastify'
import fastifyCors from 'fastify-cors'
import { XMLSerializer } from 'xmldom'
import { aiter } from 'iterator-helper'

import logger from './logger.js'
import { trees } from './mobs/behavior_tree.js'
import { Types } from './mobs/types.js'
import { SUCCESS, FAILURE, RUNNING } from './behavior.js'

const log = logger(import.meta)

/**
 * @param {{ world: any, app: import('fastify').FastifyInstance }} param
 */
function behavior({ world, app }) {
  const serializer = new XMLSerializer()

  const behavior_trees = Object.entries(trees).map(([id, tree]) => ({
    id,
    name: Types[id].displayName,
    tree: serializer.serializeToString(tree),
    instances: world.mobs.all
      .filter(({ mob }) => mob === id)
      .map(({ entity_id }) => ({
        id: entity_id,
      })),
  }))

  app.get('/behavior', async () => behavior_trees)

  const instances = world.mobs.all.map(({ entity_id }) => ({
    entity_id,
    current: {},
    stream: new PassThrough({ objectMode: true }),
  }))

  app.get('/behavior/:id', (request, reply) => {
    reply.type('text/event-stream')
    reply.header('Connection', 'keep-alive')

    const format = (data) => `data: ${JSON.stringify(data)}\n\n`

    /** @type {Object} */
    const { params } = request

    const instance = instances.find(
      ({ entity_id }) => entity_id === Number(params.id)
    )

    const stream = new PassThrough()

    for (const data of Object.entries(instance.current)) {
      stream.write(format(data))
    }

    Readable.from(
      aiter(instance.stream[Symbol.asyncIterator]()).map(format)
    ).pipe(stream)

    reply.send(stream)
  })

  const statuses = {
    [SUCCESS]: 'SUCCESS',
    [FAILURE]: 'FAILURE',
    [RUNNING]: 'RUNNING',
  }

  return ({ context: { path, entity_id }, result }) => {
    const status = statuses[result.status]

    const instance = instances.find(({ entity_id: id }) => id === entity_id)

    const key = path
      .split('.')
      .slice(1) // Skip tree.
      .filter((e, i) => i % 2 === 1)
      .join('.')

    instance.current = {
      ...instance.current,
      [key]: status,
    }

    instance.stream.write([key, status])
  }
}

export default function start_debug_server({ world }) {
  const app = fastify({ logger: log })

  app.register(fastifyCors, {
    origin: true,
  })

  app.listen(4242).then((address) => {
    log.info(
      `Arborist https://aresrpg-arborist.netlify.app/${encodeURIComponent(
        `${address}/behavior`
      )}`
    )
  })

  return {
    behavior: behavior({ world, app }),
  }
}
