import { master_client, slave_client } from './sentinel.js'

export default {
  async push({ key, value }) {
    // TODO: maybe implement a way to only push changes and not the whole state everytime
    // @see https://oss.redis.com/redisjson/path/
    return master_client.call('JSON.SET', key, '.', JSON.stringify(value))

    // we should also trigger a redis subscription here to sync all nodes
  },
  async pull(key) {
    const state = await slave_client.call('JSON.GET', key)
    return JSON.parse(state)
  },
}
