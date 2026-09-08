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

import { structure_placements } from '../../../engine/src/structure_placement.ts'
import { crowd_benchmark_entity, load_crowd } from '../../src/demo/CharacterCrowdLab.tsx'
import { fight_board_render } from '../../src/game/fight/FightViewport.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { mob_entities } from '../../src/game/mob_entities.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'

type Config = Readonly<{
  quality: EngineQuality
  mode: 'full' | 'smoke'
  location: 'city' | 'forest'
  focus?: readonly [number, number]
}>
type Sample = Readonly<{
  stage: string
  frames: number
  p95_ms: number
  completed_fps: number | null
  p99_ms: number
  max_ms: number
  resident: number
  radius: number
  queued: number
  in_flight: number
  displayed: number
  heap_bytes: number | null
  resources: ReturnType<Window['workload_resources']>
}>

const next_frame = (): Promise<number> => new Promise(requestAnimationFrame)
const percentile = (values: readonly number[], fraction: number): number =>
  values[Math.ceil(values.length * fraction) - 1]!

const wait_frames = async (frames: number, update: (frame: number) => void = () => undefined): Promise<void> => {
  // Keep the workload duration stable when hardware runs disable Chromium's frame cap.
  const end_at = performance.now() + frames * (1000 / 60)
  for (let frame = 0; frame < frames || performance.now() < end_at; frame += 1) {
    update(frame)
    await next_frame()
  }
}

const orbit_frames = async (world: ReturnType<typeof create_world>, frames: number): Promise<void> => {
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
  const elapsed: number[] = []
  let previous = started_at
  let frame: number
  const record = (): void => {
    const now = performance.now()
    elapsed.push(now - previous)
    previous = now
    frame = requestAnimationFrame(record)
  }
  frame = requestAnimationFrame(record)
  try {
    await work()
    await next_frame()
  } finally {
    cancelAnimationFrame(frame)
    world.set_active(false)
  }
  const ordered = elapsed.toSorted((a, b) => a - b)
  // Include queued GPU work in throughput without inserting a fence into every frame.
  await window.workload_gpu_done?.()
  const completed_fps = window.workload_gpu_done ? (elapsed.length * 1000) / (performance.now() - started_at) : null
  const heap_bytes = stage.startsWith('returned-') && window.collect_heap ? await window.collect_heap() : null
  const state = world.state()
  world.set_active(true)
  return {
    stage,
    frames: elapsed.length,
    p95_ms: percentile(ordered, 0.95),
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
    if (engine.backend === 'grid' && at_target) return
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

const scene_input = (location: Config['location'], requested?: readonly [number, number]) => {
  const source = worlds_source.find(({ world }) => world === 'nauvis')!
  const recipe = parse_world_recipe(world_terrain(source.world))
  if (requested) return { source, recipe, focus: requested }
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
  full: { frames: 180, characters: 200, mobs: 100, steps: 64, laps: 3 },
  smoke: { frames: 30, characters: 24, mobs: 12, steps: 4, laps: 1 },
} as const

const run = async ({ quality, mode, location, focus: requested }: Config) => {
  const profile = PROFILES[mode]
  const { source, recipe, focus } = scene_input(location, requested)
  const canvas = document.querySelector('canvas')!
  const started = performance.now()
  const world = create_world({ canvas, world: recipe, quality, initial_focus: focus })
  const samples: Sample[] = []
  if (requested) world.set_quality(quality, 11)
  world.point_at({ x: focus[0], z: focus[1] })
  world.set_time_of_day(0.31)
  world.set_audio_volume(0)
  world.set_active(true)
  let result
  try {
    samples.push(await measure(world, 'startup', () => settle(world), started))
    const ready_ms = performance.now() - started
    const backend = world.backend()
    const { frames } = profile
    if (requested)
      samples.push(
        await measure(world, 'player-entry', async () => {
          const appearance = await load_character_appearance({
            id: 'workload_player',
            classe: 'senshi',
            male: true,
            colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
            loadout: {},
          })
          world.set_character({ id: 'workload_player', appearance })
          while (world.entity_height('workload_player') === null) await next_frame()
          await wait_frames(2)
        })
      )
    samples.push(await measure(world, location, () => wait_frames(frames)))
    world.set_time_of_day(null)
    samples.push(await measure(world, `${location}-live`, () => wait_frames(frames)))
    samples.push(await measure(world, `${location}-orbit`, () => orbit_frames(world, frames)))
    world.set_time_of_day(0.31)
    let actors: Awaited<ReturnType<typeof load_crowd>> = []
    let mobs: ReturnType<typeof mob_entities> = []
    samples.push(
      await measure(world, 'population', async () => {
        actors = (await load_crowd(profile.characters, (x, z) => world.ground_height(x + focus[0], z + focus[1]))).map(
          (actor) => ({ ...actor, x: actor.x + focus[0], z: actor.z + focus[1] })
        )
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
        world.set_entities([...actors.map((actor) => crowd_benchmark_entity(actor, 'idle', 0)), ...mobs])
        const asset_deadline = performance.now() + 60_000
        while (
          actors.some(({ id }) => world.entity_height(id) === null) ||
          mobs.some(({ id }) => world.entity_height(id) === null)
        ) {
          if (performance.now() > asset_deadline) throw new Error('Crowd models did not load')
          await next_frame()
        }
        await wait_frames(2)
      })
    )
    const animation_started = performance.now()
    const animate_crowd = (): void =>
      world.set_entities([
        ...actors.map((actor) =>
          crowd_benchmark_entity(
            { ...actor, y: world.ground_height(actor.x, actor.z) },
            'run',
            performance.now() - animation_started
          )
        ),
        ...mobs.map((mob) => {
          const { anchor } = mob
          if (anchor.kind !== 'world') return mob
          const [x, , z] = anchor.position
          return { ...mob, anchor: { kind: 'world' as const, position: [x, world.ground_height(x, z), z] as const } }
        }),
      ])
    samples.push(await measure(world, 'crowd-entry', () => wait_frames(2, animate_crowd)))
    samples.push(await measure(world, 'crowd', () => wait_frames(frames, animate_crowd)))
    samples.push(await measure(world, 'crowd-orbit', () => orbit_frames(world, frames)))
    const crowd_frame = canvas.toDataURL('image/png')
    samples.push(
      await measure(world, 'flatten-transition', async () => {
        world.set_flattened(true)
        await wait_frames(60, animate_crowd)
        // Start the overview round-trip on the plane, even if a forest spawn stood on a tree.
        world.point_at({ x: focus[0], z: focus[1] })
        world.release()
        await wait_frames(60, animate_crowd)
        if (world.camera_frame()!.target[1] !== 0) throw new Error('Flat overview camera retained source elevation')
      })
    )
    samples.push(await measure(world, 'flat', () => wait_frames(frames, animate_crowd)))
    const frame = canvas.toDataURL('image/png')
    world.set_entities([])
    samples.push(
      await measure(world, 'restore-transition', async () => {
        world.set_flattened(false)
        await wait_frames(60)
        if (Math.abs(world.camera_frame()!.target[1] - world.ground_height(...focus)) > 0.01)
          throw new Error(
            `Overview elevation: ${JSON.stringify({ target: world.camera_frame()!.target, focus, actual_focus: world.camera_focus(), ground: world.ground_height(...focus) })}`
          )
      })
    )
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
        await measure(world, lap === profile.laps ? 'flat-traversal' : `traversal-${lap}`, async () => {
          if (lap === profile.laps) world.set_flattened(true)
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
          world.set_quality(tier, null)
          await settle(world)
        })
      )
    }
    for (let cycle = 0; cycle < (mode === 'full' ? 3 : 0); cycle += 1) {
      for (const tier of ['low', 'high'] as const) {
        samples.push(
          await measure(world, `quality-cycle-${tier}`, async () => {
            world.set_quality(tier, null)
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
      captures: { crowd: crowd_frame, flat: frame },
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        device_pixel_ratio: devicePixelRatio,
        render_width: canvas.width,
        render_height: canvas.height,
      },
      quality,
      location,
      focus,
      ready_ms,
      samples,
      asset_requests,
      mobs: mobs.length,
      characters: actors.length,
      state: world.state(),
    }
  } finally {
    world.dispose()
  }
  if (world.state().chunks.resident !== 0) throw new Error('Disposed world retained resident chunks')
  return { ...result, disposed_resources: window.workload_resources() }
}

declare global {
  interface Window {
    run_workload: typeof run
  }
}
window.run_workload = run
