import EventEmitter from 'events'

const emmiter = new EventEmitter()
const database = new Map()

export default {
  async push({ key, value }) {
    database.set(key, value)
    emmiter.emit(key, null)
  },
  async pull(key) {
    return database.get(key)
  },
  emmiter,
}
