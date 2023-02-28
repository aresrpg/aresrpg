export function async_tail_recursive(generator) {
  return async function* (...args) {
    let stream = generator(...args)
    while (true) {
      const { value, done } = await stream.next()

      if (done) {
        if (!value) return
        const { next_stream, parameters } = value
        stream = next_stream.apply(this, parameters)
      } else yield value
    }
  }
}

export async function* abortable(iterator) {
  try {
    yield* iterator
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error
  }
}
