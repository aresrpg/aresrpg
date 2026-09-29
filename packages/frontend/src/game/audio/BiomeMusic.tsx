// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presentation-edge observer: current biome selects the bed; mounted fight state selects its twin.

import {
  compile_runtime_world_recipe,
  parse_world_recipe,
  sample_world_column,
  type CompiledWorld,
} from '@aresrpg/engine'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { city_at_position, world_city_areas, world_terrain } from '../../content/worlds.ts'
import { selected_checkpoint_position } from '../../modules/engine_selection.ts'

import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'
import { MusicBed } from './MusicBed.tsx'
import {
  biome_music_pair,
  biome_music_position,
  follow_biome_music,
  initial_biome_music_follow,
} from './biome_music.ts'

type MusicPosition = Readonly<{ x: number; z: number }>

const music_area_at = (
  world_name: string | null,
  position: MusicPosition | null,
  compiled: CompiledWorld | null
): string | null => {
  if (!position || !compiled) return null
  const city = city_at_position(world_name, position.x, position.z)
  const area = city
    ? `city:${city.id}`
    : sample_world_column(compiled, Math.round(position.x), Math.round(position.z)).biome.name
  return `${world_name ?? 'guest'}:${area}`
}

export const BiomeMusic = ({ area }: Readonly<{ area?: string }>) => {
  const pose = useWorldPose()
  const fight_active = useAppStore(({ fight }) => fight.mode !== null && fight.mounted)
  const character = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const world_name = character?.world ?? null
  const [biome_follow, set_biome_follow] = useState(initial_biome_music_follow)

  const compiled: CompiledWorld | null = useMemo(() => {
    const terrain = world_terrain(world_name)
    if (!terrain) return null
    try {
      return compile_runtime_world_recipe(terrain)
    } catch (error) {
      console.error('Biome music could not compile the world recipe.', error)
      return null
    }
  }, [world_name])
  const checkpoint_position = useAppStore(useShallow(selected_checkpoint_position))
  const position = biome_music_position(pose, fight_active, checkpoint_position)
  const sampled_music_key = area ?? music_area_at(world_name, position, compiled)

  useEffect(() => set_biome_follow(initial_biome_music_follow()), [world_name])
  useEffect(() => {
    if (sampled_music_key) set_biome_follow((current) => follow_biome_music(current, sampled_music_key))
    // The pose identity is the sampling clock. Depending only on sampled_biome would feed a
    // candidate once, then leave the hysteresis streak permanently one short of switching.
  }, [sampled_music_key, world_name, pose])

  const biome_key = biome_follow.armed
  const biome_keys = useMemo(
    () =>
      Object.freeze([
        ...(compiled?.biomes ?? []).map(({ name }) => `${world_name ?? 'guest'}:${name}`),
        ...world_city_areas(world_name).map(({ id }) => `${world_name ?? 'guest'}:city:${id}`),
      ]),
    [compiled, world_name]
  )
  const source = biome_key ? biome_music_pair(biome_key, biome_keys)[fight_active ? 'battle' : 'roam'] : null

  return <MusicBed url={source} />
}
