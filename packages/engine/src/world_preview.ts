// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three'
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu'

import { structure_voxels } from './structure_placement.ts'
import { preview_structure_geometry, type PreviewStructureVoxel } from './world_preview_structures.ts'
import {
  compile_world_recipe,
  parse_world_recipe,
  sample_world_column,
  terrain_layer,
  terrain_slope,
  type WorldRecipe,
} from './world_recipe.ts'

type PreviewColumn = Readonly<{
  local_x: number
  local_z: number
  surface_y: number
  slope: number
  colors: Readonly<{ surface: string; subsurface: string; filler: string }>
}>

export type WorldPreview = Readonly<{
  update: (world: WorldRecipe) => Promise<void>
  set_focus: (x: number, z: number) => void
  orbit: (yaw_delta: number, pitch_delta: number) => void
  pan: (screen_x_delta: number, screen_y_delta: number) => readonly [number, number]
  settle_pan: () => void
  set_exact_radius: (radius: number) => void
  zoom: (delta: number) => void
  dispose: () => void
}>

type PreviewOptions = Readonly<{
  focus_x: number
  focus_z: number
  near_radius: number
  far_radius: number
  far_step: number
}>

export type WorldPreviewSamplePlan = Readonly<{
  options: PreviewOptions
  near_side: number
  near: readonly PreviewColumn[]
  far_side: number
  far: readonly PreviewColumn[]
  structures: readonly PreviewStructureVoxel[]
  liquid_color: string | null
}>

const DEFAULT_OPTIONS = Object.freeze({ near_radius: 192, far_radius: 2048, far_step: 32 })
const PREVIEW_FOV = 48

export const preview_pan_delta = (
  yaw: number,
  distance: number,
  viewport_height: number,
  screen_x_delta: number,
  screen_y_delta: number
): readonly [number, number] => {
  const world_per_pixel = (2 * distance * Math.tan((PREVIEW_FOV * Math.PI) / 360)) / Math.max(1, viewport_height)
  const right_x = Math.cos(yaw)
  const right_z = -Math.sin(yaw)
  const up_x = -Math.sin(yaw)
  const up_z = -Math.cos(yaw)
  const rounded = (value: number): number => Number(value.toFixed(4)) || 0
  return [
    rounded((-right_x * screen_x_delta + up_x * screen_y_delta) * world_per_pixel),
    rounded((-right_z * screen_x_delta + up_z * screen_y_delta) * world_per_pixel),
  ]
}

const color_of = (recipe: WorldRecipe, name: string): string => recipe.materials[name]?.color ?? '#000000'

const preview_column = (
  recipe: WorldRecipe,
  compiled: ReturnType<typeof compile_world_recipe>,
  focus_x: number,
  focus_z: number,
  local_x: number,
  local_z: number
): PreviewColumn => {
  const column = sample_world_column(compiled, focus_x + local_x, focus_z + local_z)
  return Object.freeze({
    local_x,
    local_z,
    surface_y: column.surface_y,
    slope: 0,
    colors: Object.freeze({
      surface: color_of(recipe, column.land.surface),
      subsurface: color_of(recipe, column.land.subsurface),
      filler: color_of(recipe, column.land.filler),
    }),
  })
}

const expose_surface = (columns: readonly PreviewColumn[], side: number, spacing: number): readonly PreviewColumn[] =>
  Object.freeze(
    columns.map((column, index) => {
      const x = index % side
      const z = Math.floor(index / side)
      const neighbours = [
        x > 0 ? columns[index - 1] : undefined,
        x + 1 < side ? columns[index + 1] : undefined,
        z > 0 ? columns[index - side] : undefined,
        z + 1 < side ? columns[index + side] : undefined,
      ].flatMap((candidate) => (candidate ? [candidate.surface_y] : []))
      return Object.freeze({ ...column, slope: terrain_slope(column.surface_y, neighbours, spacing) })
    })
  )

export const preview_sample_plan = (
  world: WorldRecipe,
  options: Partial<PreviewOptions> & Pick<PreviewOptions, 'focus_x' | 'focus_z'>
): WorldPreviewSamplePlan => {
  const recipe = parse_world_recipe(world)
  const compiled = compile_world_recipe(recipe)
  const complete = Object.freeze({ ...DEFAULT_OPTIONS, ...options })
  const near_side = complete.near_radius * 2 + 1
  const near = expose_surface(
    Array.from({ length: near_side * near_side }, (_, index) =>
      preview_column(
        recipe,
        compiled,
        complete.focus_x,
        complete.focus_z,
        (index % near_side) - complete.near_radius,
        Math.floor(index / near_side) - complete.near_radius
      )
    ),
    near_side,
    1
  )
  const far_side = Math.floor((complete.far_radius * 2) / complete.far_step) + 1
  const far = expose_surface(
    Array.from({ length: far_side * far_side }, (_, index) =>
      preview_column(
        recipe,
        compiled,
        complete.focus_x,
        complete.focus_z,
        -complete.far_radius + (index % far_side) * complete.far_step,
        -complete.far_radius + Math.floor(index / far_side) * complete.far_step
      )
    ),
    far_side,
    complete.far_step
  )
  const structures = structure_voxels(compiled, {
    min_x: complete.focus_x - complete.near_radius,
    max_x: complete.focus_x + complete.near_radius,
    min_z: complete.focus_z - complete.near_radius,
    max_z: complete.focus_z + complete.near_radius,
  }).flatMap(({ x, y, z, material_id }) => {
    const material = compiled.materials.entries[material_id]
    if (!material || y < sample_world_column(compiled, x, z).surface_y) return []
    return [
      Object.freeze({
        local_x: x - complete.focus_x,
        y,
        local_z: z - complete.focus_z,
        color: color_of(recipe, material.name),
      }),
    ]
  })
  return Object.freeze({
    options: complete,
    near_side,
    near: Object.freeze(near),
    far_side,
    far: Object.freeze(far),
    structures: Object.freeze(structures),
    liquid_color: recipe.liquid === undefined ? null : color_of(recipe, recipe.liquid),
  })
}

type Rgb = readonly [number, number, number]

const create_color_resolver = (): ((hex: string, light?: number) => Rgb) => {
  const palette = new Map<string, Rgb>()
  return (hex, light = 1) => {
    const base =
      palette.get(hex) ??
      (() => {
        const color = new Color(hex)
        const parsed = [color.r, color.g, color.b] as const
        palette.set(hex, parsed)
        return parsed
      })()
    return light === 1 ? base : [base[0] * light, base[1] * light, base[2] * light]
  }
}

const add_colored_quad = (
  positions: number[],
  colors: number[],
  indices: number[],
  points: readonly (readonly [number, number, number])[],
  point_colors: readonly Rgb[]
): void => {
  const vertex = positions.length / 3
  points.forEach((point, index) => {
    const [red, green, blue] = point_colors[index]!
    positions.push(...point)
    colors.push(red, green, blue)
  })
  indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3)
}

const add_quad = (
  positions: number[],
  colors: number[],
  indices: number[],
  points: readonly (readonly [number, number, number])[],
  color: Rgb
): void =>
  add_colored_quad(
    positions,
    colors,
    indices,
    points,
    points.map(() => color)
  )

const layer_color = (column: PreviewColumn, y: number): string =>
  column.colors[terrain_layer(column.surface_y - y - 1, column.slope)]

const add_height_edge = (
  positions: number[],
  colors: number[],
  indices: number[],
  high: PreviewColumn,
  low_y: number,
  direction: 'x' | 'z',
  positive: boolean,
  color_for: (hex: string, light?: number) => Rgb
): void => {
  const fixed = direction === 'x' ? high.local_x + (positive ? 0.5 : -0.5) : high.local_z + (positive ? 0.5 : -0.5)
  const light = direction === 'x' ? (positive ? 0.7 : 0.62) : positive ? 0.78 : 0.58
  for (let y = low_y; y < high.surface_y; y += 1) {
    const points =
      direction === 'x'
        ? ([
            [fixed, y, high.local_z - 0.5],
            [fixed, y + 1, high.local_z - 0.5],
            [fixed, y + 1, high.local_z + 0.5],
            [fixed, y, high.local_z + 0.5],
          ] as const)
        : ([
            [high.local_x - 0.5, y, fixed],
            [high.local_x - 0.5, y + 1, fixed],
            [high.local_x + 0.5, y + 1, fixed],
            [high.local_x + 0.5, y, fixed],
          ] as const)
    add_quad(positions, colors, indices, points, color_for(layer_color(high, y), light))
  }
}

const near_geometry = (plan: WorldPreviewSamplePlan): BufferGeometry => {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const color_for = create_color_resolver()
  plan.near.forEach((column, index) => {
    const { local_x: x, local_z: z, surface_y: y } = column
    add_quad(
      positions,
      colors,
      indices,
      [
        [x - 0.5, y, z - 0.5],
        [x - 0.5, y, z + 0.5],
        [x + 0.5, y, z + 0.5],
        [x + 0.5, y, z - 0.5],
      ],
      color_for(layer_color(column, y - 1))
    )
    const column_x = index % plan.near_side
    const column_z = Math.floor(index / plan.near_side)
    const east = column_x + 1 < plan.near_side ? plan.near[index + 1] : null
    const south = column_z + 1 < plan.near_side ? plan.near[index + plan.near_side] : null
    if (east && east.surface_y !== y)
      add_height_edge(
        positions,
        colors,
        indices,
        east.surface_y > y ? east : column,
        Math.min(y, east.surface_y),
        'x',
        east.surface_y <= y,
        color_for
      )
    if (south && south.surface_y !== y)
      add_height_edge(
        positions,
        colors,
        indices,
        south.surface_y > y ? south : column,
        Math.min(y, south.surface_y),
        'z',
        south.surface_y <= y,
        color_for
      )
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export const far_cell_visible = (near_radius: number, local_x: number, local_z: number, step: number): boolean => {
  const overlaps_x = local_x < near_radius && local_x + step > -near_radius
  const overlaps_z = local_z < near_radius && local_z + step > -near_radius
  return !(overlaps_x && overlaps_z)
}

const far_geometry = (plan: WorldPreviewSamplePlan): BufferGeometry => {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const color_for = create_color_resolver()
  for (let z = 0; z < plan.far_side - 1; z += 1) {
    for (let x = 0; x < plan.far_side - 1; x += 1) {
      const top_left = z * plan.far_side + x
      const bottom_left = top_left + plan.far_side
      const columns = [
        plan.far[top_left],
        plan.far[bottom_left],
        plan.far[bottom_left + 1],
        plan.far[top_left + 1],
      ] as const
      if (columns.some((column) => column === undefined)) continue
      if (!far_cell_visible(plan.options.near_radius, columns[0].local_x, columns[0].local_z, plan.options.far_step))
        continue
      add_colored_quad(
        positions,
        colors,
        indices,
        columns.map(({ local_x, local_z, surface_y }) => [local_x, surface_y - 0.75, local_z] as const),
        columns.map((column) => color_for(layer_color(column, column.surface_y - 1)))
      )
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export const create_world_preview = async (
  canvas: HTMLCanvasElement,
  initial_world: WorldRecipe
): Promise<WorldPreview> => {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  await renderer.init()
  renderer.setPixelRatio(1)
  const scene = new Scene()
  scene.background = new Color('#0b1017')
  const camera = new PerspectiveCamera(PREVIEW_FOV, 1, 0.1, 5000)
  const solid_material = new MeshBasicNodeMaterial({ side: DoubleSide, vertexColors: true })
  const far_material = new MeshBasicNodeMaterial({ side: DoubleSide, vertexColors: true })
  const water_material = new MeshBasicNodeMaterial({
    color: new Color(),
    depthWrite: false,
    opacity: 0.28,
    side: DoubleSide,
    transparent: true,
  })
  const water = new Mesh(
    new PlaneGeometry(DEFAULT_OPTIONS.far_radius * 2, DEFAULT_OPTIONS.far_radius * 2),
    water_material
  )
  water.rotation.x = -Math.PI / 2
  water.renderOrder = 2
  scene.add(water)

  let near: Mesh | null = null
  let far: Mesh | null = null
  let structures: Mesh | null = null
  let world = initial_world
  let focus_x = 0
  let focus_z = 0
  let rendered_focus_x = 0
  let rendered_focus_z = 0
  let target_y = 0
  let yaw = Math.PI * 0.25
  let pitch = 0.65
  let distance = 520
  let exact_radius: number = DEFAULT_OPTIONS.near_radius
  let disposed = false
  let rebuild_frame: number | null = null
  let draw_frame: number | null = null
  let update_resolvers: readonly (() => void)[] = []

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const draw = (): void => {
    draw_frame = null
    if (!disposed) renderer.render(scene, camera)
  }
  const request_draw = (): void => {
    if (draw_frame === null) draw_frame = requestAnimationFrame(draw)
  }
  const position_camera = (): void => {
    const horizontal = Math.cos(pitch) * distance
    camera.position.set(Math.sin(yaw) * horizontal, target_y + Math.sin(pitch) * distance, Math.cos(yaw) * horizontal)
    camera.lookAt(0, target_y, 0)
    request_draw()
  }
  const rebuild = (): void => {
    rebuild_frame = null
    if (disposed) return
    const plan = preview_sample_plan(world, { focus_x, focus_z, near_radius: exact_radius })
    const next_near = new Mesh(near_geometry(plan), solid_material)
    const next_far = new Mesh(far_geometry(plan), far_material)
    const next_structures = new Mesh(preview_structure_geometry(plan.structures), solid_material)
    next_near.renderOrder = 1
    next_structures.renderOrder = 1
    next_far.renderOrder = 0
    if (near) {
      scene.remove(near)
      near.geometry.dispose()
    }
    if (far) {
      scene.remove(far)
      far.geometry.dispose()
    }
    if (structures) {
      scene.remove(structures)
      structures.geometry.dispose()
    }
    near = next_near
    far = next_far
    structures = next_structures
    rendered_focus_x = focus_x
    rendered_focus_z = focus_z
    scene.add(next_far, next_near, next_structures)
    water.visible = plan.liquid_color !== null
    if (plan.liquid_color) water_material.color.set(plan.liquid_color)
    water.position.y = world.sea_level
    target_y = plan.near[Math.floor(plan.near.length / 2)]?.surface_y ?? 0
    position_camera()
    const completed = update_resolvers
    update_resolvers = []
    completed.forEach((resolve) => resolve())
  }
  const request_rebuild = (): void => {
    if (rebuild_frame === null) rebuild_frame = requestAnimationFrame(rebuild)
  }
  const observer = new ResizeObserver(() => {
    resize()
    request_draw()
  })
  observer.observe(canvas)
  resize()
  request_rebuild()

  return Object.freeze({
    update: (next) =>
      new Promise((resolve) => {
        world = next
        update_resolvers = [...update_resolvers, resolve]
        request_rebuild()
      }),
    set_focus: (x, z) => {
      if (x === focus_x && z === focus_z) return
      focus_x = x
      focus_z = z
      request_rebuild()
    },
    orbit: (yaw_delta, pitch_delta) => {
      yaw += yaw_delta
      pitch = Math.min(1.35, Math.max(0.12, pitch + pitch_delta))
      position_camera()
    },
    pan: (screen_x_delta, screen_y_delta) => {
      const [x_delta, z_delta] = preview_pan_delta(yaw, distance, canvas.clientHeight, screen_x_delta, screen_y_delta)
      focus_x += x_delta
      focus_z += z_delta
      const mesh_x = rendered_focus_x - focus_x
      const mesh_z = rendered_focus_z - focus_z
      near?.position.set(mesh_x, 0, mesh_z)
      far?.position.set(mesh_x, 0, mesh_z)
      structures?.position.set(mesh_x, 0, mesh_z)
      request_draw()
      return [focus_x, focus_z]
    },
    settle_pan: request_rebuild,
    set_exact_radius: (radius) => {
      const next = Math.max(64, Math.min(384, Math.round(radius / 32) * 32))
      if (next === exact_radius) return
      exact_radius = next
      request_rebuild()
    },
    zoom: (delta) => {
      distance = Math.min(1400, Math.max(60, distance * Math.exp(delta * 0.001)))
      position_camera()
    },
    dispose: () => {
      disposed = true
      observer.disconnect()
      if (rebuild_frame !== null) cancelAnimationFrame(rebuild_frame)
      if (draw_frame !== null) cancelAnimationFrame(draw_frame)
      update_resolvers.forEach((resolve) => resolve())
      update_resolvers = []
      near?.geometry.dispose()
      far?.geometry.dispose()
      structures?.geometry.dispose()
      water.geometry.dispose()
      solid_material.dispose()
      far_material.dispose()
      water_material.dispose()
      renderer.dispose()
    },
  })
}
