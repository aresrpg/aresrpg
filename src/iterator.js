const AsyncGeneratorFunction = Object.getPrototypeOf(
  async function* () {}
).constructor

export function async_tail_recursive(generator) {
  return async function* (...args) {
    let stream = generator(...args)
    while (stream !== null) {
      const { value, done } = await stream.next()

      if (done) {
        if (Array.isArray(value) && value[0] instanceof AsyncGeneratorFunction)
          stream = value[0].apply(this, value.slice(1))
        else return value
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
