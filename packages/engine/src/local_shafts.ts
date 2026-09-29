// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  Box3,
  Frustum,
  HalfFloatType,
  Matrix4,
  RenderTarget,
  Vector2,
  Vector3,
  type DirectionalLight,
  type PerspectiveCamera,
} from 'three'
import { NodeMaterial, NodeUpdateType, QuadMesh, type Node } from 'three/webgpu'
import {
  float,
  Fn,
  hash,
  If,
  int,
  ivec2,
  Loop,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { LOCAL_SHAFT_DEPTH } from './local_shafts_math.ts'
import type { Clouds } from './clouds.ts'
import type { WorldScenery, SceneryVolume } from './scenery_data.ts'
import type { QualityProfile } from './types.ts'

type Config = NonNullable<QualityProfile['effects']['local_shafts']>
type DepthNode = ReturnType<typeof texture>
type VectorUniform = ReturnType<typeof uniform<'vec3', Vector3>>
export type LocalShaftEnvironment = Readonly<{
  scenery?: WorldScenery
  clouds: Pick<Clouds, 'shadow_at'>
}>
type Context = Readonly<{
  camera: PerspectiveCamera
  sun: DirectionalLight
  sun_direction: Node<'vec3'> & { value: Vector3 }
  scene_depth: DepthNode
  config: Config
  environment: LocalShaftEnvironment
  volumes: readonly SceneryVolume[]
}>

const scene_view = (camera: PerspectiveCamera, scene_depth: DepthNode, range: number) => {
  const eye = uniform(new Vector3())
  const inverse_projection = uniform(new Matrix4())
  const world_matrix = uniform(new Matrix4())
  const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1))
  const point = inverse_projection.mul(vec4(ndc, scene_depth.sample(screenUV).r, 1))
  const view_position = point.xyz.div(point.w)
  return {
    eye,
    ray: world_matrix.mul(vec4(view_position.normalize(), 0)).xyz.normalize(),
    depth: view_position.length().min(range),
    sync: (): void => {
      eye.value.copy(camera.position)
      inverse_projection.value.copy(camera.projectionMatrixInverse)
      world_matrix.value.copy(camera.matrixWorld)
    },
  }
}

const reciprocal = (value: Node<'float'>) =>
  value.greaterThanEqual(0).select(float(1), float(-1)).div(value.abs().max(1e-6))
const largest = (value: Node<'vec3'>) => value.x.max(value.y).max(value.z)
const smallest = (value: Node<'vec3'>) => value.x.min(value.y).min(value.z)

type ShaftUniforms = Readonly<{
  shadow_depth: DepthNode
  shadow_matrix: ReturnType<typeof uniform<'mat4', Matrix4>>
  active: ReturnType<typeof uniform<'float', number>>
  sun_color: VectorUniform
  shadow_reversed: ReturnType<typeof uniform<'float', number>>
}>

const march = (context: Context, view: ReturnType<typeof scene_view>, uniforms: ShaftUniforms) =>
  Fn(() => {
    const { config, environment, volumes, sun_direction } = context
    const { shadow_depth, shadow_matrix, active, sun_color, shadow_reversed } = uniforms
    const light = float(0).toVar()
    If(active.greaterThan(0), () => {
      const inverse_ray = vec3(reciprocal(view.ray.x), reciprocal(view.ray.y), reciprocal(view.ray.z))
      const start = float(config.range).toVar()
      const end = float(0).toVar()
      volumes.forEach(({ center, size }) => {
        const offset = vec3(...center).sub(view.eye)
        const half = vec3(...size).mul(0.5)
        const a = offset.sub(half).mul(inverse_ray)
        const b = offset.add(half).mul(inverse_ray)
        const near = largest(a.min(b)).max(0)
        const far = smallest(a.max(b)).min(view.depth)
        If(far.greaterThan(near), () => {
          start.assign(start.min(near))
          end.assign(end.max(far))
        })
      })
      If(end.greaterThan(start), () => {
        const step = end.sub(start).div(config.samples).toVar()
        // hash consumes a scalar; folding both pixel coordinates prevents column-correlated bands.
        const jitter = hash(screenUV.mul(vec2(4096, 2160)).floor().dot(vec2(1, 4096)))
        // The cloud field spans hundreds of metres. One midpoint sample covers this short segment;
        // the high-frequency solid shadow still resolves at every integration step.
        const midpoint = view.eye.add(view.ray.mul(start.add(end).mul(0.5)))
        const weather = environment.clouds.shadow_at(midpoint.xz, midpoint.y)
        const transmission = float(1).toVar()
        Loop(config.samples, ({ i }) => {
          const point = view.eye.add(view.ray.mul(start.add(float(i).add(jitter).mul(step)))).toVar()
          const density = volumes
            .map(({ center, size }) => {
              const edge = vec3(...size)
                .mul(0.5)
                .sub(point.sub(vec3(...center)).abs())
              return smoothstep(0, 2, smallest(edge))
            })
            .reduce((total, amount) => total.max(amount), float(0))
            .toVar()
          const projected = shadow_matrix.mul(vec4(point, 1))
          const coord = projected.xyz.div(projected.w).toVar()
          // Three's shadow matrix maps X/Y into [0,1]; only WebGPU's texture Y needs flipping.
          const shadow_uv = vec2(coord.x, coord.y.oneMinus())
          const dimensions = vec2(shadow_depth.size(int(0)) as Node<'uvec2'>)
          const pixel = ivec2(shadow_uv.mul(dimensions).clamp(vec2(0), dimensions.sub(1)))
          const stored = shadow_depth.load(pixel).r
          const in_shadow_map = smallest(coord).greaterThanEqual(0).and(largest(coord).lessThanEqual(1))
          const normal_lit = coord.z.sub(0.0001).lessThanEqual(stored)
          const reverse_lit = coord.z.add(0.0001).greaterThanEqual(stored)
          const lit = shadow_reversed
            .greaterThan(0)
            .select(reverse_lit, normal_lit)
            .and(in_shadow_map)
            .select(float(1), float(0))
          const extinction = density.mul(step).mul(config.density).negate().exp()
          light.addAssign(transmission.mul(float(1).sub(extinction)).mul(lit).mul(weather))
          transmission.mulAssign(extinction)
        })
      })
    })
    const phase = view.ray.dot(sun_direction).mul(0.5).add(0.5).pow(2).mul(0.65).add(0.35)
    return vec4(sun_color.mul(light.mul(phase).mul(config.strength)), view.depth.div(config.range))
  })()

/** Four depth-aware taps reconstruct the reduced-resolution result without painting light over nearby silhouettes. */
const reconstruct = (target: DepthNode, depth: Node<'float'>, range: number) => {
  const size = vec2(target.size(int(0)) as Node<'uvec2'>)
  const pixel = screenUV.mul(size).sub(0.5)
  const origin = pixel.floor()
  const fraction = pixel.fract()
  const taps = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const
  const samples = taps.map(([x, y]) => {
    const value = target.load(ivec2(origin.add(vec2(x, y)).clamp(vec2(0), size.sub(1))))
    const difference = value.a
      .mul(range)
      .sub(depth)
      .abs()
      .div(depth.mul(LOCAL_SHAFT_DEPTH.slope).add(LOCAL_SHAFT_DEPTH.base))
    const weight = smoothstep(0, 1, difference)
      .oneMinus()
      .mul(x === 0 ? fraction.x.oneMinus() : fraction.x)
      .mul(y === 0 ? fraction.y.oneMinus() : fraction.y)
    return { value: value.rgb, weight }
  })
  const weight = samples.reduce<Node<'float'>>((sum, sample) => sum.add(sample.weight), float(0)).max(1e-5)
  return samples.reduce<Node<'vec3'>>((sum, sample) => sum.add(sample.value.mul(sample.weight)), vec3(0)).div(weight)
}

const create_pass = (context: Context) => {
  const { camera, sun, scene_depth, config, environment, volumes } = context
  const view = scene_view(camera, scene_depth, config.range)
  // A borrowed depth binding remains valid before the first sun shadow exists. No shadow node,
  // target, render or texture is created here; inactive frames never sample this placeholder.
  const shadow_depth = texture(scene_depth.value)
  const shadow_matrix = uniform(new Matrix4())
  const sun_color = uniform(new Vector3())
  const shadow_reversed = uniform(0)
  const active = uniform(0)
  const render_target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  render_target.texture.name = 'Local sunlight shafts'
  const material = new NodeMaterial()
  material.name = 'Local sunlight shafts'
  material.fragmentNode = march(context, view, { shadow_depth, shadow_matrix, active, sun_color, shadow_reversed })
  const quad = new QuadMesh(material)
  const target = texture(render_target.texture)
  const size = new Vector2()
  let initialized = false
  let needs_render = false
  target.updateBeforeType = NodeUpdateType.RENDER
  target.updateBefore = (frame) => {
    // RENDER callbacks always have a renderer; NodeFrame also types non-render updates.
    const renderer = frame.renderer!
    if (!initialized) {
      renderer.initRenderTarget(render_target)
      initialized = true
    }
    if (!needs_render) return
    needs_render = false
    // The preceding scene pass may replace this texture during a quality change. Bind it late.
    const current_shadow = sun.shadow.map?.depthTexture
    if (!current_shadow) {
      active.value = 0
      return
    }
    shadow_depth.value = current_shadow
    shadow_matrix.value.copy(sun.shadow.matrix)
    shadow_reversed.value = Number(sun.shadow.camera.reversedDepth)
    sun_color.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(Math.min(4, sun.intensity))
    renderer.getDrawingBufferSize(size)
    render_target.setSize(
      Math.max(1, Math.floor(size.x * config.resolution)),
      Math.max(1, Math.floor(size.y * config.resolution))
    )
    const previous = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(render_target)
      quad.render(renderer)
    } finally {
      renderer.setRenderTarget(previous)
    }
  }
  const bounds = volumes.map(({ center, size }) => {
    const half = new Vector3(...size).multiplyScalar(0.5)
    return new Box3(new Vector3(...center).sub(half), new Vector3(...center).add(half))
  })
  const frustum = new Frustum()
  const projection = new Matrix4()
  const nearest = new Vector3()
  return Object.freeze({
    active,
    color: Fn(() => {
      const color = vec3(0).toVar()
      If(active.greaterThan(0), () => {
        color.assign(reconstruct(target, view.depth, config.range))
      })
      return color
    })(),
    update: (suppressed: boolean): void => {
      view.sync()
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth)
      const nearby = bounds.some(
        (box) =>
          box.clampPoint(camera.position, nearest).distanceToSquared(camera.position) < config.range ** 2 &&
          frustum.intersectsBox(box)
      )
      const visible =
        nearby &&
        !suppressed &&
        context.sun_direction.value.y > 0.03 &&
        sun.castShadow &&
        sun.shadow.intensity > 0 &&
        sun.shadow.map !== null
      active.value = Number(visible)
      needs_render = visible
    },
    dispose: (): void => {
      material.dispose()
      render_target.dispose()
      target.dispose()
    },
  })
}

export const create_local_shafts = (
  options: Readonly<{
    camera: PerspectiveCamera
    sun: DirectionalLight
    sun_direction: Context['sun_direction']
    scene_depth: DepthNode
    config: QualityProfile['effects']['local_shafts']
    environment?: LocalShaftEnvironment
  }>
) => {
  const { config, environment } = options
  const volumes = environment?.scenery?.light_shafts ?? []
  if (!config || !environment || volumes.length === 0)
    return Object.freeze({
      active: uniform(0),
      color: vec3(0),
      update: (_suppressed: boolean): void => {},
      dispose: (): void => {},
    })
  return create_pass({ ...options, config, environment, volumes })
}
