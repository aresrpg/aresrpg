import { persist_storage } from '../settings.js'

const noop = { call: () => ({}) }
const Clients = {
  write: noop,
  read: noop,
}

if (persist_storage) {
  const { master_client, slave_client } = await import('./sentinel.js')
  Clients.write = master_client
  Clients.read = slave_client
}

export default Clients
