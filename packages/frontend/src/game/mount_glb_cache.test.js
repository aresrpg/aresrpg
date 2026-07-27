// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_mount_glb_cache } from './mount_glb_cache.js'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('create_mount_glb_cache', () => {
  test('coalesces intent preloads and keeps spawn closed until the asset resolves', async () => {
    const work = deferred()
    const calls = []
    const cache = create_mount_glb_cache((url) => {
      calls.push(url)
      return work.promise
    })

    const first = cache.preload('/dragon.glb')
    const second = cache.preload('/dragon.glb')
    expect(first).toBe(second)
    expect(cache.read('/dragon.glb')).toBe(null)
    expect(calls).toEqual(['/dragon.glb'])
    await expect(cache.for_spawn('/dragon.glb', { warm_only: true })).rejects.toThrow('was not preloaded')

    const asset = { scene: {} }
    work.resolve(asset)
    await expect(first).resolves.toBe(asset)
    expect(cache.read('/dragon.glb')).toBe(asset)
    await expect(cache.for_spawn('/dragon.glb', { warm_only: true })).resolves.toBe(asset)
    expect(calls).toEqual(['/dragon.glb'])
  })

  test('warm-only spawn refuses a cold asset without invoking the loader', async () => {
    let calls = 0
    const cache = create_mount_glb_cache(async () => {
      calls += 1
      return { scene: {} }
    })

    await expect(cache.for_spawn('/dragon.glb', { warm_only: true })).rejects.toThrow('was not preloaded')
    expect(calls).toBe(0)
  })

  test('a rejected preload is evicted so the next intent can retry', async () => {
    let calls = 0
    const asset = { scene: {} }
    const cache = create_mount_glb_cache(async () => {
      calls += 1
      if (calls === 1) throw new Error('temporary outage')
      return asset
    })

    await expect(cache.preload('/dragon.glb')).rejects.toThrow('temporary outage')
    expect(cache.read('/dragon.glb')).toBe(null)
    await expect(cache.preload('/dragon.glb')).resolves.toBe(asset)
    expect(calls).toBe(2)
  })
})
