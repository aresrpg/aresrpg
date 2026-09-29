// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EntityRender, Vec3 } from '@aresrpg/engine'

import source from '../../../../seed/content/adventure.json'
import { create_spawn_renderer } from '../game/spawn_entities.ts'
import { load_character_appearance, world_character_entity } from '../game/character_entities.ts'
import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { step_walking_follower } from '../game/core/walking_follower.ts'
import type { create_world } from '../game/core/world.ts'
import type { AdventureState } from '../modules/adventure.ts'
import { read_app_state } from '../store.ts'

import { adventure_actor_facing } from './actor_facing.ts'
import { adventure_companion } from './character.ts'
import { adventure_can_fight, adventure_roster } from './quest.ts'
import { ADVENTURE_ENCOUNTERS, adventure_group } from './content.ts'
import { adventure_model } from './models.ts'

export type AdventurePositions = Map<string, Vec3>

const advance_follower = (
  world: ReturnType<typeof create_world>,
  state: AdventureState,
  positions: AdventurePositions,
  motion: Parameters<typeof step_walking_follower>[1],
  elapsed: number
) => {
  if (!state.following || state.selected_character_id !== state.character?.id) return null
  const target = positions.get(state.selected_character_id!)
  const point = positions.get(source.companion.id)
  if (!target || !point) return null
  if (Math.hypot(target[0] - point[0], target[2] - point[2]) <= 2.5) return null
  return step_walking_follower(world.walking_world, motion, point, { x: target[0], z: target[2] }, elapsed)
}

/** Scene-owned motion is disposable. Only the adventure reducer owns party/progression facts. */
export const create_adventure_actors = (world: ReturnType<typeof create_world>, positions: AdventurePositions) => {
  let disposed = false
  let mobs: readonly EntityRender[] = []
  let actors: readonly EntityRender[] = []
  let last_pack = ''
  let motion: Parameters<typeof step_walking_follower>[1] = null
  let previous_ms = performance.now()
  let facing_yaw = 0
  const appearances = new Map<string, Awaited<ReturnType<typeof load_character_appearance>>>()
  const sources = new Map<string, unknown>()
  const submit = () => world.set_entities([...mobs, ...actors])
  const renderer = create_spawn_renderer({
    submit: (next) => {
      mobs = next
      submit()
    },
    ground_height: (x, z) =>
      world.mob_ground_height(x, z, ADVENTURE_ENCOUNTERS[read_app_state().adventure.encounter]!.position.y),
    walk_step: world.walk_step,
    entity_height: world.entity_height,
    label: world.set_world_label,
    model_for: adventure_model,
    scalar_for: (_type, scalar) => scalar,
  })
  const load = (character: ReturnType<typeof adventure_companion>) => {
    if (sources.get(character.id) === character) return
    sources.set(character.id, character)
    void load_character_appearance(character)
      .then((appearance) => {
        if (!disposed && sources.get(character.id) === character) appearances.set(character.id, appearance)
      })
      .catch((error: unknown) => console.error('Adventure companion failed to load.', error))
  }
  const waiting = adventure_companion()
  const save_pose = () => {
    const pose = read_pose()
    if (pose && !read_app_state().fight.mounted) positions.set(pose.character_id, [pose.x, pose.y, pose.z])
  }
  const unsubscribe = subscribe_pose(save_pose)
  const update = () => {
    if (disposed) return
    const state = read_app_state()
    const { adventure } = state
    const now = performance.now()
    const elapsed = Math.min(100, now - previous_ms)
    previous_ms = now
    const visible = adventure.phase === 'explore'
    const pack = visible && adventure_can_fight(adventure) ? String(adventure.encounter) : ''
    if (pack !== last_pack) {
      renderer.update(pack ? [adventure_group(adventure.encounter)] : [])
      last_pack = pack
    }
    renderer.refresh()
    const roster = adventure_roster(adventure)
    const candidates = adventure.companion ? roster : [...roster, waiting]
    candidates.forEach(load)
    const step = visible ? advance_follower(world, adventure, positions, motion, elapsed) : null
    motion = step?.motion ?? null
    if (step) {
      positions.set(source.companion.id, step.position)
      ;({ facing_yaw } = step.motion.body)
    }
    actors = candidates.flatMap((character) => {
      const appearance = appearances.get(character.id)
      const position = positions.get(character.id)
      if (!visible || character.id === adventure.selected_character_id || !appearance || !position) return []
      return [
        world_character_entity(
          { id: character.id, appearance },
          {
            position,
            facing_yaw: adventure_actor_facing(
              adventure,
              character.id,
              position,
              positions.get(adventure.selected_character_id ?? ''),
              facing_yaw
            ),
            anim: character.id === source.companion.id && motion ? 'RUN' : 'IDLE',
            gait_scale: 1,
          }
        ),
      ]
    })
    submit()
    frame = requestAnimationFrame(update)
  }
  const { position: spawn } = source.companion
  if (!positions.has(waiting.id)) positions.set(waiting.id, [spawn.x, spawn.y, spawn.z])
  let frame = requestAnimationFrame(update)
  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    unsubscribe()
    renderer.dispose()
    world.set_entities([])
    world.set_entity_caption(waiting.id, null)
  }
}
