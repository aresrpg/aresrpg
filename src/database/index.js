import Clients from './redis.js'

export default (client) => ({
  push: async (value) => {
    // TODO: maybe implement a way to only push changes and not the whole state everytime
    // @see https://oss.redis.com/redisjson/path/
    return Clients.write.call('JSON.SET', client.uuid, '.', value)

    // we should also trigger a redis subscription here to sync all nodes
  },
  pull: async () => Clients.read.call('JSON.GET', client.uuid),
})
