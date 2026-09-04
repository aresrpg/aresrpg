// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- HTML media and its React ref are browser-owned mutable effect boundaries. */
// Presentation-edge observer: current biome selects the bed; mounted fight state selects its twin.

import {
  compile_runtime_world_recipe,
  parse_world_recipe,
  sample_world_column,
  type CompiledWorld,
} from '@aresrpg/engine'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { useEffect, useMemo, useRef, useState } from 'react'

import { city_at_position, world_city_areas, world_terrain } from '../../content/worlds.ts'
import { world_scene_active } from '../../modules/navigation.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'
import { master_volume_from, scale_audio_volume } from '../core/audio_volume.ts'
import {
  biome_music_pair,
  biome_music_position,
  follow_biome_music,
  initial_biome_music_follow,
} from './biome_music.ts'

const MUSIC_VOLUME = 0.35
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

const play = (player: HTMLAudioElement): void => {
  void player.play().catch((error: unknown) => {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError')
      console.warn('Biome music could not play.', error)
  })
}

export const BiomeMusic = () => {
  const pose = useWorldPose()
  const page = useAppStore(({ navigation }) => navigation.page)
  const enabled = useAppStore(({ settings }) => settings.music_enabled)
  const master_volume = useAppStore(({ settings }) => master_volume_from(settings.master_volume))
  const fight_active = useAppStore(({ fight }) => fight.mode !== null && fight.mounted)
  const character = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const world_name = character?.world ?? null
  const player_ref = useRef<HTMLAudioElement | null>(null)
  const [biome_follow, set_biome_follow] = useState(initial_biome_music_follow)

  const compiled: CompiledWorld | null = useMemo(() => {
    const terrain = world_terrain(world_name)
    if (!terrain) return null
    try {
      return compile_runtime_world_recipe(parse_world_recipe(terrain))
    } catch (error) {
      console.error('Biome music could not compile the world recipe.', error)
      return null
    }
  }, [world_name])
  const checkpoint_position =
    character &&
    character.world === character.checkpoint_world &&
    typeof character.x === 'number' &&
    typeof character.z === 'number'
      ? Object.freeze({ x: chain_to_client_coordinate(character.x), z: chain_to_client_coordinate(character.z) })
      : null
  const position = biome_music_position(pose, fight_active, checkpoint_position)
  const sampled_music_key = music_area_at(world_name, position, compiled)

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
  const source =
    enabled && world_scene_active(page, fight_active) && biome_key
      ? biome_music_pair(biome_key, biome_keys)[fight_active ? 'battle' : 'roam']
      : null

  useEffect(() => {
    const player = player_ref.current
    if (!source) {
      player?.pause()
      return
    }
    const active_player = player ?? new Audio()
    if (!player) player_ref.current = active_player
    active_player.pause()
    active_player.src = source
    active_player.loop = true
    active_player.preload = 'auto'
    active_player.volume = scale_audio_volume(MUSIC_VOLUME)
    active_player.load()
    play(active_player)
  }, [source])

  useEffect(() => {
    if (player_ref.current) player_ref.current.volume = scale_audio_volume(MUSIC_VOLUME, master_volume)
  }, [master_volume])

  useEffect(() => {
    const resume = (): void => {
      const player = player_ref.current
      if (source && player?.paused) play(player)
    }
    globalThis.addEventListener('pointerdown', resume)
    globalThis.addEventListener('keydown', resume)
    return () => {
      globalThis.removeEventListener('pointerdown', resume)
      globalThis.removeEventListener('keydown', resume)
    }
  }, [source])

  useEffect(
    () => () => {
      player_ref.current?.pause()
      player_ref.current = null
    },
    []
  )

  return null
}
