// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Browser-API observations only: no retries, fences, readiness changes or discarded failures. */
export const install_renderer_startup_trace = (): void => {
  const drawn = new WeakSet<object>()
  const webgl_canvases = new WeakSet<object>()
  const framebuffers = new WeakMap<object, WebGLFramebuffer | null>()
  const bind_framebuffer = WebGLRenderingContext.prototype.bindFramebuffer
  WebGLRenderingContext.prototype.bindFramebuffer = new Proxy(bind_framebuffer, {
    apply: (target, receiver, args: [number, WebGLFramebuffer | null]) => {
      framebuffers.set(receiver, args[1])
      return Reflect.apply(target, receiver, args)
    },
  })
  for (const name of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name)!
    Object.defineProperty(HTMLCanvasElement.prototype, name, {
      ...descriptor,
      set: new Proxy(descriptor.set!, {
        apply: (target, receiver, args) => {
          drawn.delete(receiver)
          return Reflect.apply(target, receiver, args)
        },
      }),
    })
  }
  const counts = new Map<string, number>()
  const record = (operation: string, data: Readonly<Record<string, unknown>> = {}): void => {
    const count = counts.get(operation) ?? 0
    if (count >= 24) return
    counts.set(operation, count + 1)
    console.info('[renderer-startup]', JSON.stringify({ at_ms: performance.now(), operation, ...data }))
  }
  const objects = new WeakMap<object, number>()
  let serial = 0
  const id = (value: object): number => {
    if (!objects.has(value)) objects.set(value, ++serial)
    return objects.get(value)!
  }
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
  wrap(GPUQueue.prototype, 'copyExternalImageToTexture', ([input]) => {
    const { source } = input as GPUCopyExternalImageSourceInfo
    return {
      source: image_kind(source),
      webgl_drawn_after_resize: webgl_canvases.has(source) ? drawn.has(source) : undefined,
    }
  })
  wrap(GPUQueue.prototype, 'onSubmittedWorkDone', () => ({}))
  wrap(WebGLRenderingContext.prototype, 'shaderSource', ([shader, source]) => ({
    shader: id(shader as object),
    bytes: String(source).length,
  }))
  wrap(WebGLRenderingContext.prototype, 'compileShader', ([shader]) => ({ shader: id(shader as object) }))
  wrap(WebGLRenderingContext.prototype, 'linkProgram', ([program]) => ({ program: id(program as object) }))
  wrap(WebGLRenderingContext.prototype, 'drawArrays', (_args, receiver) => {
    const { canvas } = receiver as WebGLRenderingContext
    webgl_canvases.add(canvas)
    if (!framebuffers.get(receiver)) drawn.add(canvas)
    return {}
  })
  const completed = new WeakSet<WebGLProgram>()
  const parameter = WebGLRenderingContext.prototype.getProgramParameter
  WebGLRenderingContext.prototype.getProgramParameter = new Proxy(parameter, {
    apply: (target, receiver: WebGLRenderingContext, args: [WebGLProgram, number]) => {
      const result = Reflect.apply(target, receiver, args) as unknown
      // KHR_parallel_shader_compile completion is observed through the owner's existing query.
      if (args[1] === 0x91b1 && result === true && !completed.has(args[0])) {
        completed.add(args[0])
        record('gl.program-ready', { program: id(args[0]) })
      }
      return result
    },
  })
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
