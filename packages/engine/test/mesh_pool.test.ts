// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_mesh_pool } from '../src/mesh_pool.ts'
import type { RenderChunkRequest } from '../src/types.ts'

const chunk = (key: string): RenderChunkRequest => ({ key, coordinate: { x: 0, y: 0, z: 0 }, lod: 'near' })
const fake_worker = () => {
  const listeners = new Map<string, (event: unknown) => void>()
  const sent: unknown[] = []
  return {
    addEventListener: ((type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener)) as Worker['addEventListener'],
    postMessage: (message: unknown) => void sent.push(message),
    terminate: () => undefined,
    emit: (type: string, data: unknown) => listeners.get(type)?.(type === 'message' ? { data } : data),
    sent,
  }
}

test('superseded queued mesh jobs reject, recoverable errors drain, stale IDs cannot free a new slot', async () => {
  const workers: ReturnType<typeof fake_worker>[] = []
  const pool = create_mesh_pool({} as never, () => {
    const worker = fake_worker()
    workers.push(worker)
    return worker
  })
  const active = workers.map((_, index) =>
    pool.mesh(chunk(`active-${index}`), index).catch((error: Error) => error.message)
  )
  const old = pool.mesh(chunk('same'), 10).catch((error: Error) => error.message)
  const newest = pool.mesh(chunk('same'), 10).catch((error: Error) => error.message)
  await Promise.resolve()
  let settled = false
  void old.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBeTrue()
  const worker = workers.at(-1)!
  const request = worker.sent.at(-1) as { id: number }
  worker.emit('message', { id: request.id, error: 'download interrupted' })
  expect(await active[0]).toBe('download interrupted')
  const replacement = worker.sent.at(-1) as { id: number }
  expect(replacement.id).not.toBe(request.id)
  const count = pool.state().active
  worker.emit('message', { id: request.id, error: 'late' })
  expect(pool.state().active).toBe(count)
  worker.emit('message', { id: replacement.id, result: 'new mesh' })
  expect(await newest).toBe('new mesh')
  pool.dispose()
  await Promise.all(active)
})

test('terminal worker faults reject active, queued and future requests', async () => {
  const workers: ReturnType<typeof fake_worker>[] = []
  const pool = create_mesh_pool({} as never, () => {
    const worker = fake_worker()
    workers.push(worker)
    return worker
  })
  const pending = Array.from({ length: workers.length + 2 }, (_, index) =>
    pool.mesh(chunk(`fault-${index}`), index).catch((error: Error) => error.message)
  )
  workers[0]!.emit('error', { message: 'worker initialization failed' })
  expect(await Promise.all(pending)).toEqual(pending.map(() => 'worker initialization failed'))
  expect(pool.state()).toEqual({ active: 0, queued: 0 })
  await expect(pool.mesh(chunk('future'), 0)).rejects.toThrow('worker initialization failed')
  pool.dispose()
})

test('cancel settles an active caller without reusing its occupied worker early', async () => {
  const workers: ReturnType<typeof fake_worker>[] = []
  const pool = create_mesh_pool({} as never, () => {
    const worker = fake_worker()
    workers.push(worker)
    return worker
  })
  const pending = pool.mesh(chunk('cancelled'), 0).catch((error: Error) => error.message)
  pool.cancel('cancelled')
  expect(await pending).toContain('cancelled')
  expect(pool.state().active).toBe(1)
  const worker = workers.at(-1)!
  const request = worker.sent.at(-1) as { id: number }
  worker.emit('message', { id: request.id, result: 'late' })
  expect(pool.state().active).toBe(0)
  pool.dispose()
})
