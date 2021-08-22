import events from 'events'

import Redis from 'ioredis'

import logger from '../logger.js'

const {
  REDIS_HOST = '0.0.0.0',
  REDIS_SENTINEL_PORT = 26379,
  REDIS_MASTER_NAME = 'mymaster',
} = process.env

const log = logger(import.meta)

function retry_strategy(label) {
  return (attempt) => {
    log.info({ label, attempt }, 'Unable to reach redis, retrying..')
    if (attempt >= 10) {
      log.info({ label }, `Can't connect to redis exiting..`)
      // let a potential kubernetes scheduler do his job here
      process.exit(1)
    }

    return 250 * 2 ** attempt
  }
}

function redis_options(role, label = role) {
  return {
    sentinels: [
      {
        host: REDIS_HOST,
        port: REDIS_SENTINEL_PORT,
      },
    ],
    name: REDIS_MASTER_NAME,
    role,
    sentinelRetryStrategy: retry_strategy(label),
  }
}

export const slave_client = new Redis(redis_options('slave'))
export const master_client = new Redis(redis_options('master'))

await Promise.all([
  events.once(slave_client, 'ready'),
  events.once(master_client, 'ready'),
])

log.info('redis cluster initialized')

master_client.on('error', log.error)
slave_client.on('error', log.error)
