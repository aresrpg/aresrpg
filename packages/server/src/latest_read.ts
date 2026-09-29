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
