// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type UploadMetrics = Readonly<{ calls: number; bytes: number; cpu_ms: number; max_ms: number }>
export type GpuFrame = Readonly<{
  gpu_ms: number
  passes: number
  uploads: UploadMetrics
  large_uploads: readonly Readonly<{ size: number; bytes: number; label: string; stack: string | undefined }>[]
}>

declare global {
  interface Window {
    workload_uploads?: (reset_max?: boolean) => UploadMetrics
    workload_gpu_frame?: () => Promise<GpuFrame | null>
  }
}

/** Test-only instrumentation: count real uploads and timestamp one complete rendered frame. */
export const install_gpu_timing_probe = (): void => {
  // WebGPU bit flags; this project's DOM typings omit the runtime enum globals.
  const usage = { map_read: 1, copy_src: 4, copy_dst: 8, query_resolve: 512 }
  const request = navigator.gpu.requestAdapter.bind(navigator.gpu)
  navigator.gpu.requestAdapter = async (options) => {
    const adapter = await request(options)
    if (!adapter) return null
    const request_device = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (descriptor) => {
      const device = await request_device(descriptor)
      const large_uploads: Array<{ size: number; bytes: number; label: string; stack: string | undefined }> = []
      let calls = 0
      let bytes = 0
      let cpu_ms = 0
      let max_ms = 0
      const metrics = (reset_max = false): UploadMetrics => {
        if (reset_max) max_ms = 0
        return { calls, bytes, cpu_ms, max_ms }
      }
      window.workload_uploads = metrics
      const write = device.queue.writeBuffer.bind(device.queue)
      device.queue.writeBuffer = (buffer, offset, data, data_offset = 0, size) => {
        const element_bytes = 'BYTES_PER_ELEMENT' in data ? Number(data.BYTES_PER_ELEMENT) : 1
        const started = performance.now()
        write(buffer, offset, data, data_offset, size)
        const elapsed = performance.now() - started
        calls += 1
        const written = size === undefined ? data.byteLength - data_offset * element_bytes : size * element_bytes
        bytes += written
        if (active && written >= 65536)
          large_uploads.push({ size: buffer.size, bytes: written, label: buffer.label, stack: new Error().stack })
        cpu_ms += elapsed
        max_ms = Math.max(max_ms, elapsed)
      }
      let active: { query: GPUQuerySet; count: number } | null = null
      const create_encoder = device.createCommandEncoder.bind(device)
      device.createCommandEncoder = (descriptor) => {
        const encoder = create_encoder(descriptor)
        const begin = encoder.beginRenderPass.bind(encoder)
        encoder.beginRenderPass = (descriptor) => {
          if (!active || descriptor.timestampWrites) return begin(descriptor)
          if (active.count >= 512) throw new Error('GPU frame exceeded timestamp probe capacity')
          const first = active.count
          active.count += 2
          return begin({
            ...descriptor,
            timestampWrites: {
              querySet: active.query,
              beginningOfPassWriteIndex: first,
              endOfPassWriteIndex: first + 1,
            },
          })
        }
        return encoder
      }
      window.workload_gpu_frame = async () => {
        if (!device.features.has('timestamp-query')) return null
        await device.queue.onSubmittedWorkDone()
        const query = device.createQuerySet({ type: 'timestamp', count: 512 })
        const frame = { query, count: 0 }
        const before = metrics(true)
        large_uploads.length = 0
        active = frame
        await new Promise(requestAnimationFrame)
        active = null
        const after = metrics()
        const resolved = device.createBuffer({
          size: 4096,
          usage: usage.query_resolve | usage.copy_src,
        })
        const read = device.createBuffer({ size: 4096, usage: usage.copy_dst | usage.map_read })
        try {
          if (!frame.count) throw new Error('GPU probe observed no rendered passes')
          const encoder = create_encoder()
          encoder.resolveQuerySet(query, 0, frame.count, resolved, 0)
          encoder.copyBufferToBuffer(resolved, 0, read, 0, frame.count * 8)
          device.queue.submit([encoder.finish()])
          await read.mapAsync(1)
          const timestamps = new BigUint64Array(read.getMappedRange())
          let gpu_ns = 0n
          for (let index = 0; index < frame.count; index += 2) gpu_ns += timestamps[index + 1]! - timestamps[index]!
          read.unmap()
          return {
            gpu_ms: Number(gpu_ns) / 1_000_000,
            large_uploads: [...large_uploads],
            passes: frame.count / 2,
            uploads: {
              calls: after.calls - before.calls,
              bytes: after.bytes - before.bytes,
              cpu_ms: after.cpu_ms - before.cpu_ms,
              max_ms: after.max_ms,
            },
          }
        } finally {
          query.destroy()
          resolved.destroy()
          read.destroy()
        }
      }
      return device
    }
    return adapter
  }
}

export const upload_delta = (
  before: UploadMetrics | undefined,
  after: UploadMetrics | undefined
): UploadMetrics | null =>
  before && after
    ? {
        calls: after.calls - before.calls,
        bytes: after.bytes - before.bytes,
        cpu_ms: after.cpu_ms - before.cpu_ms,
        max_ms: after.max_ms,
      }
    : null

export const sample_gpu_frame = async (): Promise<GpuFrame | null> => (await window.workload_gpu_frame?.()) ?? null
