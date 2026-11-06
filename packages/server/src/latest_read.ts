// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Async graph reads may resolve out of request order. Delivery is latest-request-wins per key.

export const latest_keyed_reader = <T, Args extends readonly unknown[]>(
  read: (key: string, ...args: Args) => Promise<T>,
  deliver: (key: string, value: T) => void
) => {
  const generations = new Map<string, number>()
  return (key: string, ...args: Args): Promise<void> => {
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    return read(key, ...args).then((value) => {
      if (generations.get(key) === generation) deliver(key, value)
    })
  }
}

export const latest_reader = <T>(read: () => Promise<T>, deliver: (value: T) => void) => {
  let generation = 0
  return (): Promise<void> => {
    generation += 1
    const current = generation
    return read().then((value) => {
      if (generation === current) deliver(value)
    })
  }
}

/** One active read and one shared pending refresh. A queued refresh suppresses the active
 * result; errors still reject the callers of that read. Pending refreshes run after either
 * outcome. Abort retires delivery and pending work, but cannot cancel an active graph read.
 */
export const coalesced_reader = <T>(read: () => Promise<T>, deliver: (value: T) => void, signal: AbortSignal) => {
  let active: Promise<void> | null = null
  let queued: Promise<void> | null = null
  const start = (): Promise<void> => {
    active = Promise.resolve()
      .then(async () => {
        if (signal.aborted) return
        const value = await read()
        if (!queued && !signal.aborted) deliver(value)
      })
      .finally(() => {
        active = null
      })
    return active
  }
  const rerun = (): Promise<void> | void => {
    queued = null
    if (!signal.aborted) return start()
  }
  return (): Promise<void> => {
    if (signal.aborted) return Promise.resolve()
    if (queued) return queued
    if (!active) return start()
    queued = active.then(rerun, rerun)
    return queued
  }
}
