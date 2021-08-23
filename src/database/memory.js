const database = new Map()

export default {
  async push({ key, value }) {
    return database.set(key, value)
  },
  async pull(key) {
    return database.get(key)
  },
}
