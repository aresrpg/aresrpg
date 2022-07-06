import events from 'events'

import Redis from 'ioredis'

import logger from '../logger.js'
import { REDIS_HOST } from '../settings.js'

const log = logger(import.meta)
const client = new Redis(REDIS_HOST)
const subscribe_client = new Redis(REDIS_HOST)
const emitter = new events.EventEmitter()

await Promise.all([
  events.once(client, 'ready'),
  events.once(subscribe_client, 'ready'),
])

await subscribe_client.psubscribe('__keyevent*__:*')

subscribe_client.on('pmessage', (_, __, key) => emitter.emit(key, null))

log.info('redis initialized')

export default {
  async push(key, value) {
    // TODO: maybe implement a way to only push changes and not the whole state everytime
    // @see https://oss.redis.com/redisjson/path/
    return client.call('JSON.SET', key, '.', JSON.stringify(value))
  },
  async pull(key) {
    try {
      // @ts-ignore
      return JSON.parse(await client.call('JSON.GET', key))
    } catch {
      return undefined
    }
  },
  emitter,
}
