import { use_persistent_storage } from '../settings.js'
import logger from '../logger.js'

const log = logger(import.meta)
const Redis = {
  push: async (x) => '',
  pull: async (x) => ({}),
}

log.info({ use_persistent_storage }, 'initializing storage')

if (use_persistent_storage) {
  const { master_client, slave_client } = await import('./sentinel.js')
  Object.assign(Redis, {
    push: async ({ key, value }) => {
      // TODO: maybe implement a way to only push changes and not the whole state everytime
      // @see https://oss.redis.com/redisjson/path/
      return master_client.call('JSON.SET', key, '.', value)

      // we should also trigger a redis subscription here to sync all nodes
    },
    pull: async (key) => {
      const state = await slave_client.call('JSON.GET', key)
      return JSON.parse(state)
    },
  })
}

export default Redis
