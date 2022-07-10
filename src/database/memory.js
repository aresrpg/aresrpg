import EventEmitter from 'events'

const emitter = new EventEmitter()
const database = new Map()

export default {
  async push({ key, value }) {
    database.set(key, value)
    emitter.emit(key, null)
  },
  async pull(key) {
    return database.get(key)
  },
  emitter,
}
