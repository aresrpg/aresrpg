import { persist_storage } from '../settings.js'
import logger from '../logger.js'

const log = logger(import.meta)
const noop = { call: (...x) => '' }
const Clients = {
  write: noop,
  read: noop,
}

log.info({ persistence: persist_storage }, 'initializing storage')

if (persist_storage) {
  const { master_client, slave_client } = await import('./sentinel.js')
  Clients.write = master_client
  Clients.read = slave_client
}

export default Clients
