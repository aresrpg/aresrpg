// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  world_city_areas,
  client_world_position,
  compile_runtime_world_recipe,
  parse_world_recipe,
  sample_world_column,
  worlds_source,
  world_terrain,
  type EngineQuality,
} from '@aresrpg/engine'
import { generate_board } from '@aresrpg/fight'

import { LIFECYCLE_WORLD } from '../../../engine/test/browser_lifecycle.ts'
import { load_generated_city_artifacts_for } from '../../../engine/src/cities/generated_city.ts'
import { detail_builder } from '../../../engine/src/detail_builder.ts'
import { structure_placements } from '../../../engine/src/structure_placement.ts'
import { crowd_benchmark_entity, load_crowd } from '../../src/demo/CharacterCrowdLab.tsx'
import { fight_board_render } from '../../src/game/fight/FightViewport.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { mob_entities } from '../../src/game/mob_entities.ts'
import { create_frame_waiter, wait_for_frame_condition } from '../support/frame_waiter.ts'
import { upload_delta, sample_gpu_frame, type GpuFrame, type UploadMetrics } from '../support/gpu_timing_probe.ts'

import { workload_follow_cost } from './workload_follow_cost.ts'
import { run_solo_walk } from './workload_solo.ts'
import { run_hud_workload } from './workload_hud.tsx'
import {
  workload_pets,
  workload_resources,
  workload_labels,
  workload_equipped,
  workload_speech,
} from './workload_population.tsx'

type Config = Readonly<{
  quality: EngineQuality
  render_distance?: number
  mode: 'full' | 'smoke'
  benchmark?: boolean
  location: 'city' | 'forest' | 'fixture' | 'ruins'
}>
type Sample = Readonly<{
  stage: string
  duration_ms: number
  frames: number
  p95_ms: number
  p50_ms: number
  over_budget_percent: number
  completed_fps: number | null
  p99_ms: number
  max_ms: number
  resident: number
  radius: number
  queued: number
  in_flight: number
  displayed: number
  heap_bytes: number | null
  gpu_frame: GpuFrame | null
  uploads: UploadMetrics | null
  resources: ReturnType<Window['workload_resources']>
}>

const next_frame = (): Promise<number> => new Promise(requestAnimationFrame)
const percentile = (values: readonly number[], fraction: number): number =>
  values[Math.ceil(values.length * fraction) - 1]!

const orbit_frames = async (
  world: ReturnType<typeof create_world>,
  frames: number,
  wait_frames: ReturnType<typeof create_frame_waiter>
): Promise<void> => {
  let previous = performance.now()
  let total_delta = 0
  await wait_frames(frames, () => {
    const now = performance.now()
    const delta = (now - previous) * 0.28
    previous = now
    total_delta += delta
    world.follow_camera().rotate(delta, 0)
  })
  world.follow_camera().rotate(-total_delta, 0)
}

const measure = async (
  world: ReturnType<typeof create_world>,
  stage: string,
  work: () => Promise<void>,
  started_at = performance.now()
): Promise<Sample> => {
  const uploads_before = window.workload_uploads?.(true)
  const elapsed: number[] = []
  let previous = started_at
  const rendered_before = window.workload_frame_count
  window.workload_on_frame = (now): void => {
    elapsed.push(now - previous)
    previous = now
  }
  try {
    await work()
    await next_frame()
  } finally {
    window.workload_on_frame = undefined
    world.set_active(false)
  }
  const ordered = elapsed.toSorted((a, b) => a - b)
  // Include queued GPU work in throughput without inserting a fence into every frame.
  await window.workload_gpu_done?.()
  const duration_ms = performance.now() - started_at
  const completed_fps = window.workload_gpu_done
    ? ((window.workload_frame_count - rendered_before) * 1000) / duration_ms
    : null
  const heap_bytes = stage.startsWith('returned-') && window.collect_heap ? await window.collect_heap() : null
  const state = world.state()
  const uploads_after = window.workload_uploads?.()
  world.set_active(true)
  const gpu_frame = await sample_gpu_frame()
  console.info('[workload]', stage, JSON.stringify({ duration_ms, completed_fps, p95_ms: percentile(ordered, 0.95) }))
  return {
    stage,
    gpu_frame,
    uploads: upload_delta(uploads_before, uploads_after),
    duration_ms,
    frames: elapsed.length,
    p95_ms: percentile(ordered, 0.95),
    p50_ms: percentile(ordered, 0.5),
    over_budget_percent: (elapsed.filter((delta) => delta > 1000 / 120).length * 100) / elapsed.length,
    completed_fps,
    p99_ms: percentile(ordered, 0.99),
    max_ms: ordered.at(-1)!,
    resident: state.chunks.resident,
    radius: state.chunks.render_distance,
    queued: state.chunks.queued,
    in_flight: state.chunks.in_flight,
    displayed: state.displayed_chunks,
    heap_bytes,
    resources: window.workload_resources(),
  }
}

const settle = async (
  world: ReturnType<typeof create_world>,
  focus: readonly [number, number] | readonly [] = []
): Promise<void> => {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    const { engine, render, chunks } = world.state()
    if (engine.state === 'failed') throw new Error(JSON.stringify(engine))
    if (Math.max(render.failed_chunks, chunks.failed) > 0) throw new Error('Terrain failed to become resident')
    const at_target = focus.every((value, index) => world.camera_frame()?.target[index * 2] === value)
    if (
      [
        at_target,
        engine.state === 'ready',
        render.settled,
        ...[chunks.planning, chunks.queued, chunks.in_flight, chunks.evicting].map((count) => count === 0),
      ].every(Boolean)
    )
      return
    await next_frame()
  }
  throw new Error(`World did not settle: ${JSON.stringify(world.state())}`)
}

const ruins_forest = async (recipe: ReturnType<typeof parse_world_recipe>) => {
  const city = world_city_areas('nauvis').find(({ id }) => id === 'the_ruins')!
  const compiled = compile_runtime_world_recipe(recipe)
  await load_generated_city_artifacts_for(compiled.structures.cities, city)
  const candidates = Array.from(
    { length: 256 },
    (_, index) => [city.anchor_x + ((index % 16) - 8) * 32, city.anchor_z + (Math.floor(index / 16) - 8) * 32] as const
  )
  const [forest] = candidates
    .filter(([x, z]) => ['forest', 'rainforest'].includes(sample_world_column(compiled, x, z).biome.name))
    .map(([x, z]) => ({
      focus: [x, z] as const,
      trees: structure_placements(compiled, { min_x: x - 32, max_x: x + 32, min_z: z - 32, max_z: z + 32 }).length,
    }))
    .toSorted((left, right) => right.trees - left.trees)
  if (!forest) throw new Error('No forest near the Ruins')
  return forest.focus
}

const scene_input = async (location: Config['location']) => {
  const source = worlds_source.find(({ world }) => world === 'nauvis')
  if (!source) throw new Error('Missing performance world: nauvis')
  const recipe = parse_world_recipe(world_terrain(source.world))
  if (location === 'fixture') {
    const details = detail_builder()
    for (const x of [-64, 0, 64, 128]) details.box([x + 0.25, 2, 0.25], [x + 1.75, 3, 1.75], 'stone')
    return { source, recipe: { ...LIFECYCLE_WORLD, portal: false, details: details.finish() }, focus: [0, 0] as const }
  }
  if (location === 'ruins') return { source, recipe, focus: await ruins_forest(recipe) }
  const city = source.cities[0]!
  if (location === 'city') return { source, recipe, focus: client_world_position(city.x, city.z) }
  const compiled = compile_runtime_world_recipe(recipe)
  const candidates = Array.from(
    { length: 256 },
    (_, index) => [((index % 16) - 8) * 128, (Math.floor(index / 16) - 8) * 128] as const
  )
  const [forest] = candidates
    .filter(
      ([x, z]) =>
        sample_world_column(compiled, x, z).biome.name === 'forest' &&
        world_city_areas(source.world).every(
          (city) => Math.max(city.min_x - x, x - city.max_x, city.min_z - z, z - city.max_z) > 64
        )
    )
    .map(([x, z]) => ({
      focus: [x, z] as const,
      trees: structure_placements(compiled, { min_x: x - 64, max_x: x + 64, min_z: z - 64, max_z: z + 64 }).length,
    }))
    .toSorted((left, right) => right.trees - left.trees)
  const focus = forest?.focus
  if (!focus) throw new Error('Authored forest workload could not be located')
  return { source, recipe, focus }
}

const PROFILES = {
  full: {
    frames: 180,
    characters: 100,
    mobs: 48,
    pets: 100,
    packs: 12,
    nodes: 8,
    steps: 8,
    laps: 2,
    quality_cycles: 1,
  },
  smoke: {
    frames: 30,
    characters: 2,
    mobs: 1,
    pets: 1,
    packs: 12,
    nodes: 8,
    steps: 4,
    laps: 1,
    quality_cycles: 1,
  },
} as const

const run = async ({ quality, mode, location, benchmark, render_distance }: Config) => {
  const profile = PROFILES[mode]
  const wait_frames = create_frame_waiter({ benchmark, mode })
  const { source, recipe, focus } = await scene_input(location)
  const canvas = document.querySelector('canvas')!
  const started = performance.now()
  const world = create_world({ canvas, world: recipe, quality, render_distance, initial_focus: focus })
  const samples: Sample[] = []
  world.point_at({ x: focus[0], z: focus[1] })
  world.set_time_of_day(0.31)
  world.set_audio_volume(0)
  world.set_active(true)
  let result
  const resources = workload_resources(profile.packs, profile.nodes, focus, world.ground_height)
  const labels = workload_labels(resources, world.set_resource_node_label)
  const speech = workload_speech(world.set_entity_caption)
  try {
    samples.push(await measure(world, 'startup', () => settle(world), started))
    const ready_ms = performance.now() - started
    const backend = world.backend()
    const { frames } = profile
    samples.push(await measure(world, location, () => wait_frames(frames)))
    world.set_time_of_day(null)
    samples.push(await measure(world, `${location}-live`, () => wait_frames(frames)))
    samples.push(await measure(world, `${location}-orbit`, () => orbit_frames(world, frames, wait_frames)))
    world.set_time_of_day(0.31)
    let actors: Awaited<ReturnType<typeof load_crowd>> = []
    let mobs: ReturnType<typeof mob_entities> = []
    let pets: Awaited<ReturnType<typeof workload_pets>> = []
    samples.push(
      await measure(world, 'population', async () => {
        actors = (await load_crowd(profile.characters, (x, z) => world.ground_height(x + focus[0], z + focus[1]))).map(
          (actor) => ({ ...actor, x: actor.x + focus[0], z: actor.z + focus[1] })
        )
        actors = await workload_equipped(actors, mode === 'full')
        const mob_types = source.mobs.slice(0, 8).map(({ mob_type }) => mob_type)
        mobs = mob_entities(
          Array.from({ length: profile.mobs }, (_, index) => {
            const x = focus[0] + (index % 10) * 3
            const z = focus[1] + Math.floor(index / 10) * 3
            return {
              id: `workload_mob_${index}`,
              mob_type: mob_types[index % mob_types.length]!,
              anchor: { kind: 'world', position: [x, world.ground_height(x, z), z] },
              facing: { kind: 'yaw', yaw: 0 },
            }
          })
        )
        if (mobs.length !== profile.mobs) throw new Error('Workload omitted authored mob models')
        pets = await workload_pets(profile.pets, focus, world.ground_height)
        world.set_resource_nodes(resources)
        labels.show(true)
        world.set_entities([...actors.map((actor) => crowd_benchmark_entity(actor, 'idle', 0)), ...mobs, ...pets])
        const asset_deadline = performance.now() + 60_000
        while (
          actors.some(({ id }) => world.entity_height(id) === null) ||
          [...mobs, ...pets].some(({ id }) => world.entity_height(id) === null)
        ) {
          if (performance.now() > asset_deadline) throw new Error('Crowd models did not load')
          await next_frame()
        }
        // Let independently loaded equipment assemble before sampling the populated scene.
        await wait_frames(60)
      })
    )
    const animation_started = performance.now()
    const animate_crowd = (): void => {
      speech.update(actors, performance.now() - animation_started)
      world.set_entities([
        ...actors.map((actor) =>
          crowd_benchmark_entity(
            { ...actor, y: world.ground_height(actor.x, actor.z) },
            ['run', 'jump'][Math.floor(actor.offset) % 2] as 'run' | 'jump',
            performance.now() - animation_started
          )
        ),
        ...[...mobs, ...pets].map((mob) => {
          const { anchor } = mob
          if (anchor.kind !== 'world') return mob
          const [x, , z] = anchor.position
          return { ...mob, anchor: { kind: 'world' as const, position: [x, world.ground_height(x, z), z] as const } }
        }),
      ])
    }
    samples.push(await measure(world, 'crowd-entry', () => wait_frames(2, animate_crowd)))
    samples.push(await measure(world, 'crowd', () => wait_frames(frames, animate_crowd)))
    samples.push(await measure(world, 'crowd-orbit', () => orbit_frames(world, frames, wait_frames)))
    const captures = mode === 'full' ? { crowd: canvas.toDataURL('image/png') } : {}
    labels.show(false)
    await wait_frames(30, animate_crowd)
    samples.push(await measure(world, 'terrain-all-no-labels', () => wait_frames(frames, animate_crowd)))
    world.set_resource_nodes([])
    await wait_frames(30, animate_crowd)
    samples.push(await measure(world, 'terrain-all-no-resources', () => wait_frames(frames, animate_crowd)))
    world.set_resource_nodes(resources)
    labels.show(true)
    await wait_frames(30, animate_crowd)
    samples.push(await measure(world, 'terrain-all-restored', () => wait_frames(frames, animate_crowd)))
    world.set_resource_nodes(resources)
    labels.show(true)
    animate_crowd()
    await wait_frames(30, animate_crowd)
    samples.push(await measure(world, 'terrain-all-orbit', () => orbit_frames(world, frames, wait_frames)))
    labels.show(false)
    world.set_resource_nodes([])
    world.set_entities([])
    const board = fight_board_render(generate_board(7n), { x: focus[0], y: world.ground_height(...focus), z: focus[1] })
    samples.push(
      await measure(world, 'fight-entry', async () => {
        world.show_fight_board(board)
        await wait_frames(60)
      })
    )
    samples.push(await measure(world, 'fight', () => wait_frames(frames)))
    world.show_fight_board(null)
    world.point_at({ x: focus[0], z: focus[1] })
    world.release()
    await settle(world)
    const route = profile.steps
    // Continuous camera traversal uses the game's real chunk manager, workers and eviction.
    // Repeat the same out-and-back route: retained resources must plateau after the first lap.
    for (let lap = 0; lap <= profile.laps; lap += 1) {
      samples.push(
        await measure(world, `traversal-${lap}`, async () => {
          for (let step = 0; step <= route * 2; step += 1) {
            const distance = (step < route ? step : route * 2 - step) * 32
            world.set_view({ focus: [focus[0] + distance, focus[1]] })
            await next_frame()
            // Require real residency at every quarter-route, including the farthest point.
            if (step % Math.max(1, route / 4) === 0) await settle(world, [focus[0] + distance, focus[1]])
          }
        })
      )
      await settle(world)
      samples.push(await measure(world, `returned-${lap}`, () => wait_frames(frames)))
    }
    for (const tier of ['low', 'medium', 'high', quality] as const) {
      samples.push(
        await measure(world, `quality-${tier}`, async () => {
          world.set_quality(tier, render_distance ?? null)
          await settle(world)
        })
      )
    }
    for (let cycle = 0; cycle < profile.quality_cycles; cycle += 1) {
      for (const tier of ['low', 'high'] as const) {
        samples.push(
          await measure(world, `quality-cycle-${tier}`, async () => {
            world.set_quality(tier, render_distance ?? null)
            await settle(world)
            await wait_frames(2)
          })
        )
      }
    }
    const asset_requests = performance
      .getEntriesByType('resource')
      .filter(({ name }) => /\.(glb|bin|json)(?:\?|$)/.test(name)).length
    result = {
      backend,
      captures,
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        device_pixel_ratio: devicePixelRatio,
        render_width: canvas.width,
        render_height: canvas.height,
      },
      quality,
      location,
      world: source.world,
      focus,
      ready_ms,
      samples,
      asset_requests,
      mobs: mobs.length,
      characters: actors.length,
      equipped: mode === 'full',
      pets: pets.length,
      resource_nodes: resources.length,
      resource_labels: labels.count,
      state: world.state(),
    }
  } finally {
    speech.dispose()
    labels.dispose()
    world.dispose()
  }
  if (world.state().chunks.resident !== 0) throw new Error('Disposed world retained resident chunks')
  return { ...result, disposed_resources: window.workload_resources() }
}

// This fails if warm-up, camera, lighting, or residency differ between comparisons.
// Keep scene inputs fixed, warm each variant, then repeat in reverse order.
const run_diagnostics = async ({
  quality,
  location,
  render_distance,
  canopy,
  water,
  party_size = 6,
  navigation,
}: Readonly<
  Pick<Config, 'quality' | 'location' | 'render_distance'> & {
    canopy: 'clusters' | 'voxels'
    water: boolean
    party_size?: number
    navigation?: boolean
  }
>) => {
  const input = await scene_input(location)
  const recipe = { ...input.recipe, canopy, liquid: water ? input.recipe.liquid : undefined }
  const canvas = document.querySelector('canvas')!
  const world = create_world({ canvas, world: recipe, quality, render_distance, initial_focus: input.focus })
  const wait_frames = create_frame_waiter({ benchmark: true })
  const samples: Sample[] = []
  const captures: Record<string, string> = {}
  world.point_at({ x: input.focus[0], z: input.focus[1] })
  world.set_time_of_day(0.31)
  world.set_audio_volume(0)
  world.set_active(true)
  try {
    await settle(world)
    const actors = await workload_equipped(
      (await load_crowd(party_size, (x, z) => world.ground_height(x + input.focus[0], z + input.focus[1]))).map(
        (actor) => ({
          ...actor,
          x: actor.x + input.focus[0],
          z: actor.z + input.focus[1],
        })
      )
    )
    const cases = [
      { name: 'empty', count: 0, aura: undefined },
      { name: 'solo', count: 1, aura: undefined },
      { name: 'party', count: party_size, aura: undefined },
      { name: 'party-unbroken', count: party_size, aura: 'unbroken' },
      { name: 'party-admin', count: party_size, aura: 'admin' },
    ] as const
    for (const [repeat, variants] of [cases, cases.toReversed()].entries()) {
      for (const variant of variants) {
        const selected = actors.slice(0, variant.count)
        const started = performance.now()
        const update = (): void =>
          world.set_entities(
            selected.map((actor) => ({
              ...crowd_benchmark_entity(actor, 'run', performance.now() - started),
              presentation: 'individual',
              aura: variant.aura,
            }))
          )
        update()
        await wait_for_frame_condition(() => selected.every(({ id }) => world.entity_height(id) !== null))
        const animate = selected.length > 0 ? update : undefined
        await wait_frames(120, animate)
        await window.workload_gpu_done!()
        samples.push(await measure(world, `${variant.name}-${repeat}`, () => wait_frames(180, animate)))
        captures[variant.name] = canvas.toDataURL('image/png')
      }
    }
    return {
      quality,
      location,
      canopy,
      water,
      party_size,
      focus: input.focus,
      render_distance: world.state().chunks.render_distance,
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        device_pixel_ratio: devicePixelRatio,
        render_width: canvas.width,
        render_height: canvas.height,
      },
      backend: world.backend(),
      navigation: navigation ? await workload_follow_cost(world, actors) : null,
      samples,
      captures,
    }
  } finally {
    world.dispose()
  }
}

// The blocking smoke check proves the real renderer can present terrain and release its resources.
const run_renderer_smoke = async () => {
  const world = create_world({
    canvas: document.querySelector('canvas')!,
    world: LIFECYCLE_WORLD,
    quality: 'low',
    render_distance: 1,
  })
  world.set_audio_volume(0)
  world.point_at({ x: 0, z: 0 })
  world.set_active(true)
  try {
    await settle(world)
    await window.workload_gpu_done!()
    return { backend: world.backend(), displayed: world.state().displayed_chunks }
  } finally {
    world.dispose()
  }
}

declare global {
  interface Window {
    run_renderer_smoke: typeof run_renderer_smoke
    run_diagnostics: typeof run_diagnostics
    run_workload: typeof run
  }
}
window.run_renderer_smoke = run_renderer_smoke
window.run_diagnostics = run_diagnostics
window.run_workload = run
window.run_solo_walk = run_solo_walk
window.run_hud_workload = run_hud_workload
