// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import { POSITION_INTERVAL_MS, type ClientPacket } from '@aresrpg/protocol'
import { compile_runtime_world_recipe, world_terrain } from '@aresrpg/engine/data'
import { create_world_collision } from '@aresrpg/engine/locomotion/world_collision'
import { step_walking_follower } from '@aresrpg/engine/locomotion/walking_follower'
import { MOUNT_SPEED_SCALE } from '@aresrpg/engine/locomotion/controller'
import type { WalkWorld, WalkPoint } from '@aresrpg/engine/locomotion/walkable'

import { area_allows_segment, assert_area_position, type WorldArea } from './target_constraints.ts'
import { begin_idle, step_idle, type IdleState } from './idle.ts'

export type Travel = Readonly<{
  area?: WorldArea
  riding?: boolean
  /** A journey: the background loop walks the hero to its target instead of letting it wander. */
  journey?: boolean
  character_id: string
  checkpoint: string
  world: string
  x: number
  z: number
  target_x: number
  target_z: number
}>
type Pose = Readonly<{
  riding?: boolean
  gliding?: boolean
  idle?: IdleState
  checkpoint: string
  position: WalkPoint
  motion: Parameters<typeof step_walking_follower>[1]
}>
const collision_world = (world: string): WalkWorld => {
  const recipe = world_terrain(world)
  if (!recipe) throw new Error('world_terrain_unavailable')
  let failure: unknown
  const collision = create_world_collision(compile_runtime_world_recipe(recipe), (error) => {
    failure = error
  })
  return {
    ...collision,
    ready: (area) => {
      if (failure) throw failure
      return collision.ready(area)
    },
  }
}
const initial_pose = (world: WalkWorld, travel: Travel): Pose => {
  const x = chain_to_client_coordinate(travel.x)
  const z = chain_to_client_coordinate(travel.z)
  return { checkpoint: travel.checkpoint, position: [x, world.ground_height(x, z), z], motion: null }
}
/** A session owns transient feet; chain checkpoints remain the authority across reconnects. */
export const create_locomotion = ({
  now = () => performance.now(),
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  world_for = collision_world,
  random = Math.random,
}: Readonly<{
  now?: () => number
  wait?: (ms: number) => Promise<void>
  world_for?: (world: string) => WalkWorld
  random?: () => number
}> = {}) => {
  let generation = 0
  const poses = new Map<string, Pose>()
  const worlds = new Map<string, WalkWorld>()
  const world_of = (name: string) => {
    const world = worlds.get(name) ?? world_for(name)
    worlds.set(name, world)
    return world
  }
  const publish = async (
    travel: Pick<Travel, 'character_id' | 'checkpoint'>,
    pose: Pose,
    send: (packet: ClientPacket) => Promise<boolean>,
    epoch: number
  ) => {
    const [x, y, z] = pose.position
    if (
      !(await send({
        type: 'packet/position',
        character_id: travel.character_id,
        checkpoint: travel.checkpoint,
        x: client_to_chain_coordinate(x),
        y,
        z: client_to_chain_coordinate(z),
        riding: pose.riding === true,
        gliding: pose.gliding === true,
      }))
    )
      throw new Error('needs_resync')
    if (epoch !== generation) throw new Error('needs_resync')
    poses.set(travel.character_id, pose)
  }
  const walk = async (authorize: () => Promise<Travel | null>, send: (packet: ClientPacket) => Promise<boolean>) => {
    const epoch = generation
    const check = async () => {
      const current = await authorize()
      if (epoch !== generation) throw new Error('needs_resync')
      return current
    }
    const travel = await check()
    if (!travel) return
    assert_area_position(travel.area, travel.world, travel.x, travel.z)
    assert_area_position(travel.area, travel.world, travel.target_x, travel.target_z)
    const allowed = (from: WalkPoint, to: WalkPoint) => {
      if (
        !area_allows_segment(
          travel.area,
          travel.world,
          [client_to_chain_coordinate(from[0]), client_to_chain_coordinate(from[2])],
          [client_to_chain_coordinate(to[0]), client_to_chain_coordinate(to[2])]
        )
      )
        throw new Error('target_outside_area')
      return true
    }
    const world = world_of(travel.world)
    // Wait for authored collision before choosing the initial ground elevation.
    const x = chain_to_client_coordinate(travel.x)
    const z = chain_to_client_coordinate(travel.z)
    while (!world.ready({ min_x: x - 1, max_x: x + 1, min_z: z - 1, max_z: z + 1 })) {
      await wait(POSITION_INTERVAL_MS)
      await check()
    }
    const previous = poses.get(travel.character_id)
    let pose = previous?.checkpoint === travel.checkpoint ? previous : initial_pose(world, travel)
    await check()
    allowed(pose.position, pose.position)
    await publish(travel, pose, send, epoch)
    let at = now()
    const target = { x: chain_to_client_coordinate(travel.target_x), z: chain_to_client_coordinate(travel.target_z) }
    while (true) {
      await wait(POSITION_INTERVAL_MS)
      const current = await check()
      if (JSON.stringify(current) !== JSON.stringify(travel)) throw new Error('needs_resync')
      const next_at = now()
      const step = step_walking_follower(world, pose.motion, pose.position, target, next_at - at, allowed)
      at = next_at
      pose = { checkpoint: travel.checkpoint, position: step.position, motion: step.motion }
      await publish(travel, pose, send, epoch)
      if (step.arrived) return
    }
  }
  const idle = async (
    authorize: () => Promise<readonly Travel[] | null>,
    send: (packet: ClientPacket) => Promise<boolean>
  ) => {
    const epoch = generation
    let at = now()
    /** One step of a journey: real walking toward the target, by position packets alone. Nothing is
     * signed, so a long trip never holds the wallet's signing slot. An arrived hero stands still. */
    const journey_step = async (travel: Travel, world: WalkWorld, pose: Pose, next_at: number) => {
      const target = { x: chain_to_client_coordinate(travel.target_x), z: chain_to_client_coordinate(travel.target_z) }
      // A hero with a mount keeps its pace, which the server's speed rule allows for an equipped pet.
      const pace = travel.riding ? MOUNT_SPEED_SCALE : 1
      const step = step_walking_follower(world, pose.motion, pose.position, target, next_at - at, undefined, pace)
      await publish(
        travel,
        { checkpoint: travel.checkpoint, position: step.position, motion: step.motion, riding: travel.riding },
        send,
        epoch
      )
    }
    const advance = async (travel: Travel, next_at: number) => {
      const world = world_of(travel.world)
      const previous = poses.get(travel.character_id)
      const retained = previous?.checkpoint === travel.checkpoint ? previous : undefined
      const [x, , z] = retained
        ? retained.position
        : [chain_to_client_coordinate(travel.x), 0, chain_to_client_coordinate(travel.z)]
      if (!world.ready({ min_x: x - 2, max_x: x + 2, min_z: z - 2, max_z: z + 2 })) return
      const pose = retained ?? initial_pose(world, travel)
      if (travel.journey) return journey_step(travel, world, pose, next_at)
      const step = step_idle(
        world,
        pose.motion?.body,
        pose.position,
        pose.idle ?? begin_idle(pose.position, next_at, random),
        next_at,
        next_at - at,
        random,
        travel.riding === true
      )
      await publish(
        travel,
        {
          checkpoint: travel.checkpoint,
          position: step.position,
          motion: step.motion,
          idle: step.state,
          riding: step.riding,
          gliding: step.gliding,
        },
        send,
        epoch
      )
    }
    while (epoch === generation) {
      await wait(POSITION_INTERVAL_MS)
      const travels = await authorize()
      if (!travels || epoch !== generation) return
      const next_at = now()
      for (const travel of travels) {
        const current = await authorize()
        if (
          !current?.some(
            (item) => item.character_id === travel.character_id && item.checkpoint === travel.checkpoint
          ) ||
          epoch !== generation
        )
          return
        await advance(travel, next_at)
      }
      at = next_at
    }
  }
  return {
    walk,
    idle,
    /** Where each hero's feet stand, in chain coordinates, with the checkpoint the walk began from. */
    positions: (): Readonly<Record<string, Readonly<{ x: number; z: number; checkpoint: string }>>> =>
      Object.fromEntries(
        [...poses].map(([character_id, pose]) => [
          character_id,
          {
            x: client_to_chain_coordinate(pose.position[0]),
            z: client_to_chain_coordinate(pose.position[2]),
            checkpoint: pose.checkpoint,
          },
        ])
      ),
    rest: async (send: (packet: ClientPacket) => Promise<boolean>) => {
      const epoch = generation
      for (const [character_id, pose] of poses) {
        if (!pose.riding && !pose.gliding) continue
        await publish(
          { character_id, checkpoint: pose.checkpoint },
          { checkpoint: pose.checkpoint, position: pose.position, motion: pose.motion },
          send,
          epoch
        )
      }
    },
    clear: () => {
      generation += 1
      poses.clear()
      worlds.clear()
    },
  }
}
