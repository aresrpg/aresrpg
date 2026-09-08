// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Observe retained GPU objects without keeping them alive or confusing implicit GC with leaks.
type Resources = Readonly<{ buffers: number; large_buffers: number; buffer_bytes: number; textures: number }>
type Adapter = Readonly<{
  vendor: string
  architecture: string
  device: string
  description: string
  fallback: boolean
}>
declare global {
  interface Window {
    workload_adapter: Adapter | null
    workload_resources: () => Resources
    workload_gpu_done?: () => Promise<void>
    collect_heap?: () => Promise<number>
  }
}

export const install_probe = (): void => {
  type Allocation = {
    ref: WeakRef<GPUBuffer | GPUTexture>
    device: symbol
    kind: 'buffers' | 'textures'
    bytes: number
  }
  const allocations = new Set<Allocation>()
  window.workload_adapter = null
  window.workload_resources = () => {
    const counts = { buffers: 0, large_buffers: 0, buffer_bytes: 0, textures: 0 }
    for (const allocation of allocations) {
      if (!allocation.ref.deref()) allocations.delete(allocation)
      else {
        counts[allocation.kind] += 1
        counts.buffer_bytes += allocation.bytes
        if (allocation.bytes >= 256 * 1024) counts.large_buffers += 1
      }
    }
    return counts
  }
  const { gpu } = navigator
  if (!gpu) return
  const request = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (options) => {
    const adapter = await request(options)
    if (!adapter) return null
    const { info } = adapter
    window.workload_adapter = {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      fallback: info.isFallbackAdapter,
    }
    const request_device = adapter.requestDevice.bind(adapter)
    adapter.requestDevice = async (descriptor) => {
      const device = await request_device(descriptor)
      window.workload_gpu_done = () => device.queue.onSubmittedWorkDone()
      const identity = Symbol('device')
      const track = <Resource extends GPUBuffer | GPUTexture>(
        resource: Resource,
        kind: 'buffers' | 'textures',
        bytes = 0
      ): Resource => {
        const allocation = { ref: new WeakRef(resource), device: identity, kind, bytes }
        allocations.add(allocation)
        const destroy = resource.destroy.bind(resource)
        resource.destroy = () => {
          allocations.delete(allocation)
          destroy()
        }
        return resource
      }
      const create_buffer = device.createBuffer.bind(device)
      device.createBuffer = (input) => track(create_buffer(input), 'buffers', input.size)
      const create_texture = device.createTexture.bind(device)
      device.createTexture = (input) => track(create_texture(input), 'textures')
      const destroy = device.destroy.bind(device)
      device.destroy = () => {
        for (const allocation of allocations) if (allocation.device === identity) allocations.delete(allocation)
        destroy()
      }
      return device
    }
    return adapter
  }
}
