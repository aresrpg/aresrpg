// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterEntityRender, Vec3 } from '@aresrpg/engine'

import { load_character_appearance } from '../game/character_entities.ts'

type Appearance = Readonly<{
  id: string
  classe: string
  male: boolean
  colors: readonly string[]
  loadout: Readonly<Record<string, string>>
}>
type Patrol = Readonly<{ path: readonly (readonly number[])[]; speed: number; pause: number; phase: number }>
type Pose = Pick<CharacterEntityRender, 'anchor' | 'facing' | 'animation'>
export type MenuActor = Readonly<{
  entity: Omit<CharacterEntityRender, 'anchor' | 'facing' | 'animation'>
  pose: (seconds: number) => Pose
}>

/** Presentation-only authored walks. No gameplay actor, navigation store or network observer. */
export const menu_patrol = ({ path, speed, pause, phase }: Patrol) => {
  const lengths = path.map((point, index) =>
    Math.hypot(...point.map((value, axis) => path[(index + 1) % path.length]![axis]! - value))
  )
  const durations = lengths.map((length) => length / speed + pause)
  const segments = path.map((point, index) => {
    const next = path[(index + 1) % path.length]!
    const start = durations.slice(0, index).reduce((sum, value) => sum + value, 0)
    return {
      point,
      next,
      start,
      end: start + durations[index]!,
      travel: lengths[index]! / speed,
      yaw: Math.atan2(next[0]! - point[0]!, next[2]! - point[2]!),
    }
  })
  const duration = durations.reduce((sum, value) => sum + value, 0)
  return (seconds: number): Pose => {
    const time = (((seconds + phase) % duration) + duration) % duration
    const index = segments.findIndex((segment) => time < segment.end)
    const segment = segments[index]!
    const local = time - segment.start
    const waiting = local < pause
    const progress = Math.max(0, local - pause) / segment.travel
    const previous = segments[(index + segments.length - 1) % segments.length]!.yaw
    const delta = Math.atan2(Math.sin(segment.yaw - previous), Math.cos(segment.yaw - previous))
    const turn = Math.min(1, local / 1.5)
    return {
      anchor: {
        kind: 'world',
        position: segment.point.map((value, axis) => value + (segment.next[axis]! - value) * progress) as [
          number,
          number,
          number,
        ],
      },
      facing: { kind: 'yaw', yaw: previous + delta * turn * turn * (3 - 2 * turn) },
      animation: { name: waiting ? 'IDLE' : 'WALK', time_scale: waiting ? 1 : speed / 1.6 },
    }
  }
}

export const load_menu_actors = async (
  hero: Appearance & Readonly<{ position: readonly number[]; yaw: number }>,
  residents: readonly (Appearance & Patrol)[]
): Promise<readonly MenuActor[]> => {
  const sources = [hero, ...residents]
  const appearances = await Promise.all(
    sources.map((source) => load_character_appearance({ ...source, colors: source.colors as [string, string, string] }))
  )
  const entity = (index: number) => ({
    id: sources[index]!.id,
    kind: 'character' as const,
    appearance: appearances[index]!,
  })
  return [
    {
      entity: entity(0),
      pose: () => ({
        anchor: { kind: 'world', position: hero.position as Vec3 },
        facing: { kind: 'yaw', yaw: hero.yaw },
        animation: { name: 'IDLE', time_scale: 1 },
      }),
    },
    ...residents.map((source, index) => ({ entity: entity(index + 1), pose: menu_patrol(source) })),
  ]
}

export const menu_entities = (
  actors: readonly MenuActor[],
  seconds: number,
  reduced_motion: boolean
): readonly CharacterEntityRender[] =>
  actors.map(({ entity, pose }) => ({
    ...entity,
    ...pose(reduced_motion ? 0 : seconds),
    ...(reduced_motion ? { animation: { name: 'IDLE' as const, time_scale: 1 } } : {}),
  }))
