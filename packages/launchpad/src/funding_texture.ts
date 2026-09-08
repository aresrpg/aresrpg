// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const FUNDING_FRAME_MS = 1_000 / 18

/** One small drawing buffer, independent of device pixel ratio. */
export const funding_texture_size = (width: number, height: number) => {
  const scale = Math.min(1, 768 / Math.max(1, width), 40 / Math.max(1, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

// Slowly varying halftone dots echo the supplied Aftermath portfolio reference.
const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float elapsed;
uniform float gold_share;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 flowing = gl_FragCoord.xy + vec2(elapsed * 3.0, sin(elapsed * 0.4) * 1.5);
  vec2 cell = floor(flowing / 6.0);
  vec2 point = mod(flowing, 6.0) - 3.0;
  float field = 0.5 + 0.24 * sin(cell.x * 0.19 + cell.y * 0.64 + elapsed * 0.75)
                    + 0.2 * cos(cell.x * 0.075 - cell.y * 0.42 - elapsed * 0.5);
  float radius = 0.65 + field * 2.1;
  float dot_mask = 1.0 - smoothstep(radius - 0.45, radius + 0.45, length(point));
  float warmth = clamp(gold_share * 1.4 + uv.x * 0.45 - 0.35, 0.0, 1.0);
  vec3 blue = vec3(0.23, 0.49, 0.83);
  vec3 gold = vec3(0.91, 0.68, 0.31);
  vec3 tint = mix(blue, gold, warmth);
  vec3 base = tint * (0.36 + field * 0.1);
  vec3 ink = tint * (0.76 + field * 0.24);
  gl_FragColor = vec4(mix(base, ink, dot_mask * 0.82), 1.0);
}
`

export const create_funding_texture = (gl: WebGLRenderingContext) => {
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const shaders: WebGLShader[] = []
  const dispose = (): void => {
    shaders.forEach((shader) => gl.deleteShader(shader))
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  try {
    if (!program || !buffer) throw new Error('Funding texture could not allocate WebGL resources')
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(kind)
      if (!shader) throw new Error('Funding texture could not allocate a shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`Funding texture shader compilation failed: ${gl.getShaderInfoLog(shader)}`)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Funding texture shader linking failed: ${gl.getProgramInfoLog(program)}`)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const resolution = gl.getUniformLocation(program, 'resolution')
    const elapsed = gl.getUniformLocation(program, 'elapsed')
    const gold_share = gl.getUniformLocation(program, 'gold_share')
    return {
      draw: (width: number, height: number, seconds: number, gold: number): void => {
        gl.viewport(0, 0, width, height)
        gl.uniform2f(resolution, width, height)
        gl.uniform1f(elapsed, seconds)
        gl.uniform1f(gold_share, gold)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
