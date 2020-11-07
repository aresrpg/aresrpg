/* TODO: remove this when streaming-iterables will implement it
 * Implementation modified from https://github.com/reconbot/streaming-iterables/blob/master/lib/reduce.ts#L3 */
export async function* _scan(func, start, iterable) {
  let value = start
  yield value
  for await (const nextItem of iterable) {
    value = await func(value, nextItem)
    yield value
  }
  return value
}

export function scan(func, start, iterable) {
  if (start === undefined) {
    return (curriedStart, curriedIterable) =>
      scan(func, curriedStart, curriedIterable)
  }
  if (iterable === undefined) {
    return (curriedIterable) => scan(func, start, curriedIterable)
  }

  return _scan(func, start, iterable)
}

export async function* _skip(count, iterable) {
  let skipped = 0
  for await (const val of iterable) {
    if (skipped === count) yield await val
    else skipped++
  }
}

export function skip(count, iterable) {
  if (iterable === undefined) {
    return (curriedIterable) => skip(count, curriedIterable)
  }

  return _skip(count, iterable)
}
