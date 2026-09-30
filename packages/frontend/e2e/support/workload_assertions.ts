// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect } from '@playwright/test'
import type {} from '../fixtures/workload.ts'

export const expect_released_resources = (result: Awaited<ReturnType<Window['run_workload']>>) => {
  expect(result.disposed_resources).toEqual({ buffers: 0, large_buffers: 0, buffer_bytes: 0, textures: 0 })
  expect(result.state.render.failed_chunks).toBe(0)
  expect(result.state.chunks.failed).toBe(0)
  const returned = result.samples.filter(({ stage }) => stage.startsWith('returned-'))
  expect(returned.length).toBeGreaterThanOrEqual(2)
  for (const sample of returned) {
    expect(sample.resident).toBeLessThanOrEqual(returned[0]!.resident)
    expect(sample.radius).toBeLessThanOrEqual(returned[0]!.radius)
    expect(sample.queued + sample.in_flight).toBe(0)
    expect(sample.resources.buffers).toBeLessThanOrEqual(returned[0]!.resources.buffers)
    expect(sample.resources.textures).toBeLessThanOrEqual(returned[0]!.resources.textures)
    if (sample.heap_bytes !== null)
      expect(sample.heap_bytes - returned[0]!.heap_bytes!).toBeLessThanOrEqual(32 * 1024 * 1024)
  }
  const high = result.samples.filter(({ stage }) => stage === 'quality-high' || stage === 'quality-cycle-high')
  expect(high.length).toBeGreaterThanOrEqual(2)
  for (const sample of high.slice(1)) {
    expect(sample.resources.textures).toBe(high[0]!.resources.textures)
    expect(sample.resources.large_buffers).toBe(high[0]!.resources.large_buffers)
  }
}
