// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from '@aresrpg/engine'

import { load_character_appearance, world_character_entity } from '../game/character_entities.ts'
import type { create_world } from '../game/core/world.ts'
import type { SimulatorCharacter } from '../modules/simulator.ts'

const ORBIT_MS = 2_200
const POISON_MS = 3_200

export const adventure_ending_frame = (elapsed_ms: number) =>
  Object.freeze({
    blur: Math.min(1, Math.max(0, (elapsed_ms - ORBIT_MS) / POISON_MS)) * 4,
    dying: elapsed_ms >= ORBIT_MS + POISON_MS,
  })

const next_frame = (signal: Readonly<AbortSignal>): Promise<number> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const cancel = () => {
      cancelAnimationFrame(frame)
      reject(signal.reason)
    }
    const frame = requestAnimationFrame((now) => {
      signal.removeEventListener('abort', cancel)
      resolve(now)
    })
    signal.addEventListener('abort', cancel, { once: true })
  })

type World = Readonly<ReturnType<typeof create_world>>

const wait_for_scene = async (world: World, ids: readonly string[], signal: Readonly<AbortSignal>): Promise<void> => {
  const deadline = performance.now() + 30_000
  await next_frame(signal)
  while (!signal.aborted) {
    const { render, chunks } = world.state()
    const pending = chunks.planning + chunks.queued + chunks.in_flight + chunks.evicting
    if (render.settled && pending === 0 && ids.every((id) => world.entity_height(id) !== null)) return
    if (performance.now() >= deadline) throw new Error('Adventure ending scene did not load')
    await next_frame(signal)
  }
}

/** The existing world, camera and entity death cues own every frame; no second renderer or combat result. */
export const play_adventure_ending = async ({
  world,
  roster,
  origin,
  signal,
  reduced_motion,
  present,
}: Readonly<{
  world: World
  roster: readonly SimulatorCharacter[]
  origin: Vec3
  signal: Readonly<AbortSignal>
  reduced_motion: boolean
  present: (frame: ReturnType<typeof adventure_ending_frame>) => void
}>): Promise<void> => {
  const appearances = await Promise.all(roster.map(load_character_appearance))
  signal.throwIfAborted()
  world.point_at({ x: origin[0], y: origin[1], z: origin[2] })
  const camera = world.follow_camera()
  camera.detach?.()
  camera.dolly(2)
  world.set_entities(
    roster.map((character, index) => {
      const x = origin[0] + index * 1.5
      const z = origin[2] + index
      return world_character_entity(
        { id: character.id, appearance: appearances[index]! },
        {
          position: [x, world.mob_ground_height(x, z, origin[1]), z],
          facing_yaw: Math.PI,
          anim: 'IDLE',
          gait_scale: 1,
          presentation: 'individual',
        }
      )
    })
  )
  await wait_for_scene(
    world,
    roster.map(({ id }) => id),
    signal
  )
  let previous = performance.now()
  let elapsed = 0
  const orbit_rate = reduced_motion ? 0 : 0.24
  while (true) {
    const now = await next_frame(signal)
    const delta = Math.min(100, now - previous)
    previous = now
    elapsed += delta
    const frame = adventure_ending_frame(elapsed)
    camera.rotate(delta * orbit_rate, 0)
    present(frame)
    if (frame.dying) break
  }
  signal.throwIfAborted()
  const deaths = await Promise.all(
    roster.map(({ id }) =>
      world.play_fight_cue({
        id: `adventure_poison:${id}`,
        type: 'death',
        entity_id: id,
        source_id: id,
        cell: 0,
        cause: 'poison',
      })
    )
  )
  signal.throwIfAborted()
  if (deaths.some((played) => !played)) throw new Error('Adventure death presentation was interrupted')
}
