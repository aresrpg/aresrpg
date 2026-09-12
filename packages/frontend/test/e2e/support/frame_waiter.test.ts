// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_flat_projection, set_flat_projection, step_flat_projection, project_height } from '@aresrpg/engine'

import { create_frame_waiter, wait_for_frame_condition } from '../../../e2e/support/frame_waiter.ts'

const sample = async (benchmark: boolean, frame_ms: number, frames: number, mode: 'full' | 'smoke' = 'smoke') => {
  let elapsed = 0
  const updates: number[] = []
  const wait = create_frame_waiter({
    benchmark,
    mode,
    now: () => elapsed,
    next_frame: async () => {
      elapsed += frame_ms
      return elapsed
    },
  })
  await wait(frames, (frame) => updates.push(frame))
  return { elapsed, updates }
}

test('slow compatibility rendering retains its time window without requiring benchmark frame counts', async () => {
  const result = await sample(false, 600, 60)
  expect(result.elapsed).toBe(1_200)
  expect(result.updates).toEqual([0, 1])
})

test('benchmark sampling still requires both frame count and duration', async () => {
  expect((await sample(true, 600, 60)).updates).toHaveLength(60)
  const fast = await sample(true, 1, 60)
  expect(fast.elapsed).toBeGreaterThanOrEqual(1_000)
  expect(fast.updates.length).toBeGreaterThanOrEqual(60)
})

test('compatibility sampling advances animation updates even for a slow short window', async () => {
  expect((await sample(false, 600, 2)).updates).toEqual([0, 1])
  expect((await sample(false, 1, 60)).elapsed).toBeGreaterThanOrEqual(1_000)
})

test('full workloads retain frame counts even without hardware enforcement', async () => {
  expect((await sample(false, 600, 60, 'full')).updates).toHaveLength(60)
})

test('flattening finishes on its real state after the slow sampling window ends', async () => {
  let elapsed = 0
  let projection = set_flat_projection(create_flat_projection(), true)
  const next_frame = async () => {
    elapsed += 600
    projection = step_flat_projection(projection, 0.1)
    return elapsed
  }
  const wait = create_frame_waiter({ now: () => elapsed, next_frame })
  await wait(60)
  expect(project_height(167, projection.amount)).toBeGreaterThan(0)
  await wait_for_frame_condition(
    () => project_height(167, projection.amount) === 0,
    next_frame,
    () => elapsed
  )
  expect(project_height(167, projection.amount)).toBe(0)
  projection = set_flat_projection(projection, false)
  await wait_for_frame_condition(
    () => project_height(167, projection.amount) === 167,
    next_frame,
    () => elapsed
  )
  expect(project_height(167, projection.amount)).toBe(167)
})

test('a broken transition still fails within its deadline', async () => {
  let elapsed = 0
  await expect(
    wait_for_frame_condition(
      () => false,
      async () => {
        elapsed += 1_000
        return elapsed
      },
      () => elapsed
    )
  ).rejects.toThrow('World transition did not reach its expected state')
})
