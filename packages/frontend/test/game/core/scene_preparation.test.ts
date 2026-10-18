// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_scene_preparation } from '../../../src/game/core/scene_preparation.ts'

const pending = () => Promise.withResolvers<boolean>()

test('only the current scene GPU completion releases preparation', async () => {
  const first = pending()
  const second = pending()
  let calls = 0
  const preparation = create_scene_preparation({
    prepare_scene: () => (++calls === 1 ? first.promise : second.promise),
    fail: () => {
      throw new Error('unexpected failure')
    },
  })
  preparation.tick(() => false)
  expect(calls).toBe(0)
  preparation.tick(() => true)
  preparation.tick(() => true)
  expect(calls).toBe(1)
  preparation.reset()
  preparation.tick(() => true)
  first.resolve(true)
  await first.promise
  expect(preparation.ready()).toBe(false)
  second.resolve(true)
  await second.promise
  expect(preparation.ready()).toBe(true)
  preparation.tick(() => {
    throw new Error('ready scenes must stop sampling')
  })
})

test('hidden or unsized scenes retry, while disposed scenes ignore completion', async () => {
  const first = pending()
  let calls = 0
  const preparation = create_scene_preparation({
    prepare_scene: () => {
      calls += 1
      return first.promise
    },
    fail: () => {
      throw new Error('unexpected failure')
    },
  })
  preparation.tick(() => true)
  first.resolve(false)
  await first.promise
  expect(preparation.ready()).toBe(false)
  preparation.tick(() => true)
  expect(calls).toBe(2)
  preparation.dispose()
  await Promise.resolve()
  preparation.tick(() => true)
  expect(calls).toBe(2)
  expect(preparation.ready()).toBe(false)
})

test('GPU errors reach recovery; retired failures cannot poison another scene', async () => {
  const first = pending()
  const second = pending()
  const failures: unknown[] = []
  let calls = 0
  const preparation = create_scene_preparation({
    prepare_scene: () => (++calls === 1 ? first.promise : second.promise),
    fail: (failure) => {
      failures.push(failure)
    },
  })
  preparation.tick(() => true)
  preparation.reset()
  preparation.tick(() => true)
  first.reject(new Error('retired'))
  await Promise.resolve()
  expect(failures).toEqual([])
  second.reject(new Error('GPU preparation failed'))
  await Promise.resolve()
  expect(failures).toMatchObject([{ code: 'graphics_unavailable', detail: 'Error: GPU preparation failed' }])
  expect(preparation.ready()).toBe(false)
})
