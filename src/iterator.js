export function flatten(generator) {
  return async function* (...args) {
    const streams = [generator(...args)]
    while (streams.length >= 0) {
      const { value, done } = await streams[streams.length - 1].next()

      if (done) {
        streams.pop()
      }

      if (typeof value === 'object' && Symbol.asyncIterator in value) {
        streams.push(value)
      } else {
        yield value
      }
    }
  }
}
