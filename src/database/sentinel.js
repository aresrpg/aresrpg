import events from 'events'

import Redis from 'ioredis'

import logger from '../logger.js'

const {
  REDIS_HOST = '0.0.0.0',
  REDIS_SENTINEL_PORT = 26379,
  REDIS_MASTER_NAME = 'mymaster',
} = process.env

const log = logger(import.meta)

const probe_status = {
  status: true,
}

const retryStrategy = (label) => (attempt) => {
  log.info({ label, attempt }, 'Unable to reach redis, retrying..')
  if (attempt >= 10) {
    probe_status.status = false
    log.info({ label }, `Can't connect to redis exiting..`)
    // let a potential kubernetes scheduler do his job here
    process.exit(1)
  }

  return 250 * 2 ** attempt
}

const redis_options = (role, label = role) => ({
  sentinels: [
    {
      host: REDIS_HOST,
      port: REDIS_SENTINEL_PORT,
    },
  ],
  name: REDIS_MASTER_NAME,
  role,
  sentinelRetryStrategy: retryStrategy(label),
})

const slave_client = new Redis(redis_options('slave'))
const master_client = new Redis(redis_options('master'))

await Promise.all([
  events.once(slave_client, 'ready'),
  events.once(master_client, 'ready'),
])

log.info({ master: true, slave: true }, 'redis cluster initialized')

new Set([master_client, slave_client]).forEach((client) => {
  client.on('error', () => {})
})

export { master_client, slave_client, probe_status }
