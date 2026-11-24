// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The page's ground, the tide nebula: a dithered cloud whose colour drifts between the Sui blue and the ember orange.
// A still poster paints with the page. After the page has loaded and the browser is idle, a canvas draws the cloud in one
// low-resolution WebGL pass and fades in over the poster. Without WebGL, after a lost context, or under reduced motion
// the poster (or one still frame) stays. One ground per document; unmounting releases its context and listeners.
// The link-card painter (packages/frontend/social_card_render.ts) evaluates FRAGMENT once on the CPU for its still:
// a change to the cloud changes both.
import { useEffect, useRef } from 'react'

/** CSS pixels per dither cell: the canvas holds one texel per cell and is scaled by a whole number. */
const CELL = 3
/** The cloud drifts slowly; twenty frames a second is enough for it. */
const FRAME_MS = 1000 / 20
/** The cloud's clock at its first frame, so the opening frame is the approved one. */
const CLOCK_START = 40

const CONTEXT: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'low-power',
}

const VERTEX = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'

/* The cloud: fbm warped by fbm, breathing over about 15 s, quantized in five levels through an 8×8 Bayer matrix.
   Its colour is a slow wave between the cold and the warm token that crosses the page in about two minutes.
   The window's lowest quarter, where the footer's small grey text lands, fades to the plain floor so that text
   keeps 4.5:1. */
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_bg, u_lo, u_cold, u_warm;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= .5; } return v / .9375; }
float b2(vec2 a){ a = floor(a); return fract(a.x * .5 + a.y * a.y * .75); }
float b4(vec2 a){ return b2(.5 * a) * .25 + b2(a); }
float b8(vec2 a){ return b4(.5 * a) * .25 + b2(a); }
void main(){
  vec2 fc = gl_FragCoord.xy, n = fc / u_res;
  vec2 p = fc / u_res.y * 2.4;
  float t = u_t * .02;
  vec2 q = vec2(fbm(p + vec2(t, -.7 * t)), fbm(p + vec2(4.1 - .6 * t, 1.7 + .4 * t)));
  float d = smoothstep(.36, .9, fbm(p * 1.1 + 1.8 * q + vec2(-.5 * t, .3 * t)));
  float w = max(mix(.42, 1., smoothstep(.1, .95, n.y)), .85 * smoothstep(.62, 1., n.x));
  d *= w * (.78 + .22 * (.5 + .5 * sin(u_t * .42))) * smoothstep(.1, .28, n.y);
  float l = clamp(floor(d * 5. + b8(fc)) / 5., 0., 1.);
  vec3 core = mix(u_cold, u_warm, .5 + .5 * sin(u_t * .05 + n.x * 2.4));
  vec3 c = mix(mix(u_bg, u_lo, .09 + .08 * n.y), mix(u_bg, core, .55), smoothstep(0., .6, l) * .38);
  gl_FragColor = vec4(mix(c, core, smoothstep(.55, 1., l) * .2), 1.);
}`

type Rgb = readonly [number, number, number]

const token_rgb = (style: Readonly<CSSStyleDeclaration>, name: string): Rgb => {
  const value = parseInt(style.getPropertyValue(name).trim().slice(1, 7), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** The ground's colours, from the theme tokens: the near-black floor, the bone low tone, and the cold and warm pair. */
const read_palette = (
  style: Readonly<CSSStyleDeclaration>
): Readonly<Record<'u_bg' | 'u_lo' | 'u_cold' | 'u_warm', Rgb>> => ({
  u_bg: token_rgb(style, '--aui-bg'),
  u_lo: token_rgb(style, '--aui-brass-lo'),
  u_cold: token_rgb(style, '--aui-sui'),
  u_warm: token_rgb(style, '--aui-orange'),
})

type Scene = Readonly<{ resolution: WebGLUniformLocation | null; time: WebGLUniformLocation | null }>

const compile = (gl: Readonly<WebGLRenderingContext>, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
}

/** Compiles the cloud and uploads its colours; null when this GPU cannot run it, and the poster stays. */
const build_scene = (gl: Readonly<WebGLRenderingContext>, palette: ReturnType<typeof read_palette>): Scene | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  for (const [name, rgb] of Object.entries(palette)) gl.uniform3fv(gl.getUniformLocation(program, name), rgb)
  return { resolution: gl.getUniformLocation(program, 'u_res'), time: gl.getUniformLocation(program, 'u_t') }
}

/** Draws the cloud into a canvas it adds to `holder`; returns what stops it and gives the GPU context back. */
const start_ground = (holder: Readonly<HTMLElement>): (() => void) => {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('class', 'aui-ground-canvas')
  const gl = canvas.getContext('webgl', CONTEXT)
  if (!gl) return () => undefined
  holder.append(canvas)
  const palette = read_palette(getComputedStyle(holder))
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let scene = build_scene(gl, palette)
  let clock = CLOCK_START
  let last = 0
  let frame = 0
  let in_view = true
  let size: Readonly<{ width: number; height: number }> | null = null

  const draw = (): void => {
    if (!scene || !size) return
    gl.uniform1f(scene.time, clock)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    canvas.setAttribute('data-live', '')
  }
  const runs = (): boolean => scene !== null && size !== null && in_view && !document.hidden && !motion.matches
  const tick = (now: number): void => {
    frame = 0
    if (!runs()) return
    if (!last || now - last >= FRAME_MS - 2) {
      clock += last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      draw()
    }
    frame = requestAnimationFrame(tick)
  }
  const wake = (): void => {
    if (frame || !runs()) return
    last = 0
    frame = requestAnimationFrame(tick)
  }
  const fit = (): void => {
    if (!scene || !size) return
    const columns = Math.max(1, Math.ceil(size.width / CELL))
    const rows = Math.max(1, Math.ceil(size.height / CELL))
    canvas.setAttribute('width', String(columns))
    canvas.setAttribute('height', String(rows))
    canvas.style.setProperty('width', `${columns * CELL}px`)
    canvas.style.setProperty('height', `${rows * CELL}px`)
    gl.viewport(0, 0, columns, rows)
    gl.uniform2f(scene.resolution, columns, rows)
    draw()
    wake()
  }
  const sizes = new ResizeObserver(([entry]) => {
    if (!entry) return
    size = { width: entry.contentRect.width, height: entry.contentRect.height }
    fit()
  })
  const view = new IntersectionObserver(([entry]) => {
    in_view = entry?.isIntersecting ?? true
    wake()
  })
  const on_motion = (): void => {
    draw()
    wake()
  }
  const on_lost = (event: Readonly<Event>): void => {
    event.preventDefault()
    scene = null
    canvas.removeAttribute('data-live')
  }
  const on_restored = (): void => {
    scene = build_scene(gl, palette)
    fit()
  }
  sizes.observe(holder)
  view.observe(holder)
  document.addEventListener('visibilitychange', wake)
  motion.addEventListener('change', on_motion)
  canvas.addEventListener('webglcontextlost', on_lost)
  canvas.addEventListener('webglcontextrestored', on_restored)
  return () => {
    cancelAnimationFrame(frame)
    sizes.disconnect()
    view.disconnect()
    document.removeEventListener('visibilitychange', wake)
    motion.removeEventListener('change', on_motion)
    canvas.removeEventListener('webglcontextlost', on_lost)
    canvas.removeEventListener('webglcontextrestored', on_restored)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.remove()
  }
}

/** Runs `start` once the page has loaded and the browser is idle, so the ground never holds the first paint. */
const after_first_paint = (start: () => void): (() => void) => {
  const idle = typeof requestIdleCallback === 'function'
  let handle = 0
  const schedule = (): void => {
    handle = idle ? requestIdleCallback(start) : window.setTimeout(start, 0)
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
  return () => {
    window.removeEventListener('load', schedule)
    if (idle) cancelIdleCallback(handle)
    else window.clearTimeout(handle)
  }
}

/** The page's ground: a fixed layer behind everything the page draws. Mount it once per document. */
export const Ground = () => {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = holder.current
    if (!element) return
    let stop: (() => void) | null = null
    const cancel = after_first_paint(() => {
      stop = start_ground(element)
    })
    return () => {
      cancel()
      stop?.()
    }
  }, [])
  return <div ref={holder} aria-hidden="true" className="aui-ground" />
}
