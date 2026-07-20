/**
 * Adopt a resource produced by an asynchronous boot only while its owner is still live. A resource that
 * resolves after dispose is released immediately and is never published to the dead owner.
 *
 * @template {{ dispose: () => void }} T
 * @param {T} resource
 * @param {() => boolean} is_disposed
 * @param {(resource: T) => void} adopt
 * @returns {boolean} whether the resource was adopted
 */
export function adopt_async_resource(resource, is_disposed, adopt) {
  if (is_disposed()) {
    resource.dispose()
    return false
  }
  adopt(resource)
  return true
}

/**
 * Replay deferred work only while its holder remains live. A callback can synchronously dispose the holder
 * (Three scene mutations dispatch events), so lifecycle is rechecked between callbacks rather than once.
 *
 * @param {Array<() => void>} callbacks
 * @param {() => boolean} is_disposed
 * @returns {number} callbacks completed
 */
export function flush_live_callbacks(callbacks, is_disposed) {
  let completed = 0
  for (const callback of callbacks) {
    if (is_disposed()) break
    callback()
    completed += 1
  }
  return completed
}
