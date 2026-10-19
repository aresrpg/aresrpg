// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Browser-API observations only: no retries, fences, readiness changes or discarded failures. */
export const install_renderer_startup_trace = (): void => {
  const counts = new Map<string, number>()
  const record = (operation: string, data: Readonly<Record<string, unknown>> = {}): void => {
    const count = counts.get(operation) ?? 0
    if (count >= 24) return
    counts.set(operation, count + 1)
    console.info('[renderer-startup]', JSON.stringify({ at_ms: performance.now(), operation, ...data }))
  }
  let serial = 0
  const wrap = (
    owner: object,
    name: string,
    describe: (args: readonly unknown[], receiver: object) => Readonly<Record<string, unknown>>
  ): void => {
    const native = Reflect.get(owner, name) as (...args: unknown[]) => unknown
    Reflect.set(
      owner,
      name,
      new Proxy(native, {
        apply: (target, receiver, args: unknown[]) => {
          const data = { call: ++serial, ...describe(args, receiver) }
          record(`${name}:start`, data)
          const result = Reflect.apply(target, receiver, args) as unknown
          // Observe settlement but return the original promise, preserving the caller's identity and rejection.
          if (result instanceof Promise)
            void result.then(
              () => record(`${name}:done`, data),
              (error: unknown) => record(`${name}:failed`, { ...data, error: String(error) })
            )
          else record(`${name}:done`, data)
          return result
        },
      })
    )
  }
  const image_kind = (value: unknown): string => Object.prototype.toString.call(value)
  wrap(window, 'createImageBitmap', ([source]) => ({ source: image_kind(source) }))
  wrap(GPUDevice.prototype, 'createShaderModule', ([input]) => {
    const descriptor = input as GPUShaderModuleDescriptor
    return { label: descriptor.label, bytes: descriptor.code.length }
  })
  for (const name of [
    'createRenderPipeline',
    'createRenderPipelineAsync',
    'createComputePipeline',
    'createComputePipelineAsync',
  ])
    wrap(GPUDevice.prototype, name, ([input]) => ({ label: (input as GPUObjectDescriptorBase).label }))
  wrap(GPUQueue.prototype, 'copyExternalImageToTexture', ([input]) => ({
    source: image_kind((input as GPUCopyExternalImageSourceInfo).source),
  }))
  wrap(GPUQueue.prototype, 'onSubmittedWorkDone', () => ({}))
  const request = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = new Proxy(request, {
    apply: (target, receiver, args) => {
      record('gpu.requestDevice')
      const pending = Reflect.apply(target, receiver, args) as Promise<GPUDevice>
      void pending.then(
        (device) => {
          record('gpu.device-ready')
          void device.lost.then((info) => record('gpu.device-lost', { reason: info.reason, message: info.message }))
        },
        (error: unknown) => record('gpu.requestDevice-failed', { error: String(error) })
      )
      return pending
    },
  })
}
