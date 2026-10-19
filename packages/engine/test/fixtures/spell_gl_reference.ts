// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Test-only WebGL transport for the independent authored-shader reference.

export type SpellUniforms = Readonly<Record<string, number | readonly number[] | Float32Array>>
export const SPELL_VERTEX = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'

const compile_program = async (
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
  signal: AbortSignal = new AbortController().signal
) => {
  const program = gl.createProgram()!
  const parallel = gl.getExtension('KHR_parallel_shader_compile')
  const shaders = (
    [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const
  ).map(([type, source]) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    return shader
  })
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  try {
    // Querying COMPILE_STATUS/LINK_STATUS immediately turns driver work into a main-thread stall.
    while (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      signal.throwIfAborted()
      if (gl.isContextLost()) throw new Error('Spell context was lost during compilation')
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    signal.throwIfAborted()
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'Spell shader link failed')
    return program
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    shaders.forEach((shader) => gl.deleteShader(shader))
  }
}

export const spell_gl_program = async (
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
  signal?: AbortSignal
) => {
  const program = await compile_program(gl, vertex, fragment, signal)
  const uniforms = new Map<string, Readonly<{ location: WebGLUniformLocation; type: number }>>()
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index)!
    uniforms.set(info.name.replace(/\[0\]$/u, ''), {
      location: gl.getUniformLocation(program, info.name)!,
      type: info.type,
    })
  }
  const setters: Readonly<
    Record<number, (location: WebGLUniformLocation, value: number | readonly number[] | Float32Array) => void>
  > = {
    [gl.FLOAT]: (location, value) => gl.uniform1f(location, Number(value)),
    [gl.INT]: (location, value) => gl.uniform1i(location, Number(value)),
    [gl.BOOL]: (location, value) => gl.uniform1i(location, Number(value)),
    [gl.SAMPLER_2D]: (location, value) => gl.uniform1i(location, Number(value)),
    [gl.FLOAT_VEC2]: (location, value) => gl.uniform2fv(location, value as Float32Array),
    [gl.FLOAT_VEC3]: (location, value) => gl.uniform3fv(location, value as Float32Array),
    [gl.FLOAT_VEC4]: (location, value) => gl.uniform4fv(location, value as Float32Array),
    [gl.FLOAT_MAT4]: (location, value) => gl.uniformMatrix4fv(location, false, value as Float32Array),
  }
  return {
    program,
    use: (values: SpellUniforms): void => {
      gl.useProgram(program)
      Object.entries(values).forEach(([name, value]) => {
        const uniform = uniforms.get(name)
        if (uniform) setters[uniform.type]!(uniform.location, value)
      })
    },
    dispose: () => gl.deleteProgram(program),
  }
}

const image_from = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Spell atlas could not load: ${url}`))
    image.src = url
  })

export const create_spell_gl = async (fragment: string, signal?: AbortSignal) => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('The authored spell shader requires WebGL')
  const program = await spell_gl_program(gl, SPELL_VERTEX, fragment, signal).catch((error: unknown) => {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    throw error
  })
  const vertices = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const make_texture = (): WebGLTexture => {
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }
  let atlas: readonly WebGLTexture[] = []
  const cell_texture = make_texture()
  const surfaces = Array.from({ length: 2 }, () => ({ texture: make_texture(), framebuffer: gl.createFramebuffer()! }))
  const scene_texture = make_texture()
  let loaded: Promise<void> | null = null
  let disposed = false
  const bind = (unit: number, texture: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }
  const fullscreen = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  return {
    canvas,
    gl,
    bind,
    prepare: (urls: readonly string[]): Promise<void> => {
      loaded ??= Promise.all(urls.map(image_from)).then((images) => {
        if (disposed) return
        atlas = images.map((image, index) => {
          const texture = make_texture()
          bind(index, texture)
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
          return texture
        })
      })
      return loaded
    },
    resize: (width: number, height: number): void => {
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      for (const surface of surfaces) {
        bind(3, surface.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface.texture, 0)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    },
    render: (
      input: HTMLCanvasElement | null,
      masks: WebGLTexture,
      frames: readonly Readonly<{ uniforms: SpellUniforms; cells: Uint8Array; width: number; height: number }>[]
    ): void => {
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
      gl.viewport(0, 0, canvas.width, canvas.height)
      const scene_unit = atlas.length,
        actor_unit = scene_unit + 1,
        cell_unit = actor_unit + 1,
        original_unit = cell_unit + 1
      atlas.forEach((texture, index) => bind(index, texture))
      bind(scene_unit, scene_texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      if (input) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
      bind(original_unit, scene_texture)
      bind(actor_unit, masks)
      let previous = scene_texture
      frames.forEach((frame, index) => {
        bind(cell_unit, cell_texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.cells)
        const output = surfaces[(index + 1) % 2]!
        gl.bindFramebuffer(gl.FRAMEBUFFER, index + 1 === frames.length ? null : output.framebuffer)
        bind(scene_unit, previous)
        program.use({
          ...frame.uniforms,
          aresScene: scene_unit,
          aresActors: actor_unit,
          aresCells: cell_unit,
          aresOriginal: original_unit,
          aresComposite: Number(input !== null && index + 1 === frames.length),
        })
        fullscreen()
        previous = output.texture
      })
      gl.flush()
    },
    dispose: (): void => {
      disposed = true
      program.dispose()
      gl.deleteBuffer(vertices)
      for (const texture of [...atlas, cell_texture, scene_texture, ...surfaces.map((surface) => surface.texture)])
        gl.deleteTexture(texture)
      surfaces.forEach((surface) => gl.deleteFramebuffer(surface.framebuffer))
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
