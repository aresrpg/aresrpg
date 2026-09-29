// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from './types.ts'

export type UploadJob = Readonly<{ key: string; origin: Vec3; bytes: number; upload: () => boolean }>

/** One admission budget for voxel and detail buffers. A false result waits for capacity release. */
export const create_upload_queue = (now: () => number = () => performance.now()) => {
  const pending = new Map<string, UploadJob>()
  let order: readonly UploadJob[] = []
  let dirty = false
  let blocked = false
  const clear = (): void => {
    pending.clear()
    order = []
    blocked = false
    dirty = false
  }
  return Object.freeze({
    add: (job: UploadJob): void => {
      pending.set(job.key, job)
      dirty = true
    },
    remove: (key: string): void => {
      pending.delete(key)
      dirty = true
    },
    clear,
    dispose: clear,
    release: (): void => {
      blocked = false
    },
    size: (): number => pending.size,
    blocked_count: (): number => (blocked ? pending.size : 0),
    drain: (focus: Vec3, byte_budget: number, time_budget: number): number => {
      if (blocked) return 0
      if (dirty) {
        const distance = (job: UploadJob) => (job.origin[0] - focus[0]) ** 2 + (job.origin[2] - focus[2]) ** 2
        order = [...pending.values()].sort((a, b) => distance(a) - distance(b))
        dirty = false
      }
      const start = now()
      let bytes = 0
      let admitted = 0
      for (const job of order) {
        if (pending.get(job.key) !== job) continue
        // One oversized voxel mesh may make progress; detail jobs are bounded before admission.
        if (admitted > 0 && (bytes + job.bytes > byte_budget || now() - start >= time_budget)) break
        if (!job.upload()) {
          blocked = true
          break
        }
        if (pending.get(job.key) === job) pending.delete(job.key)
        bytes += job.bytes
        admitted += 1
      }
      order = order.filter((job) => pending.get(job.key) === job)
      return bytes
    },
  })
}

export type UploadQueue = ReturnType<typeof create_upload_queue>
