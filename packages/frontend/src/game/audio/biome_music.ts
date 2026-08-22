// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every world-biome identity receives one stable pseudo-random owned track and its battle twin.

export const MUSIC_TRACKS = Object.freeze([
  'arctic',
  'desert',
  'glacier',
  'grassland',
  'scorched',
  'swamp',
  'taiga',
  'temperate',
  'tropical',
] as const)

const hash_string = (value: string): number => {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export const biome_music_track = (biome_key: string, tracks: readonly string[] = MUSIC_TRACKS): string =>
  tracks[hash_string(biome_key) % tracks.length]!

export const biome_music_pair = (biome_key: string): Readonly<{ roam: string; battle: string }> => {
  const track = biome_music_track(biome_key)
  return Object.freeze({
    roam: `/music/${track}.mp3`,
    battle: `/music/${track}_battle.mp3`,
  })
}

export type BiomeMusicFollow = Readonly<{
  armed: string | null
  candidate: string | null
  streak: number
}>

export const initial_biome_music_follow = (): BiomeMusicFollow =>
  Object.freeze({ armed: null, candidate: null, streak: 0 })

export const follow_biome_music = (
  state: BiomeMusicFollow,
  biome_key: string | null,
  confirmations = 20
): BiomeMusicFollow => {
  if (!biome_key || biome_key === state.armed)
    return state.candidate === null ? state : Object.freeze({ ...state, candidate: null, streak: 0 })
  if (state.armed === null) return Object.freeze({ armed: biome_key, candidate: null, streak: 0 })
  const streak = state.candidate === biome_key ? state.streak + 1 : 1
  return streak < confirmations
    ? Object.freeze({ ...state, candidate: biome_key, streak })
    : Object.freeze({ armed: biome_key, candidate: null, streak: 0 })
}

type MusicPosition = Readonly<{ x: number; z: number }>

/** A mounted fight pauses the live pose feed, so its last chain checkpoint is the reload fallback. */
export const biome_music_position = (
  live: MusicPosition | null,
  fight_active: boolean,
  checkpoint: MusicPosition | null
): MusicPosition | null => live ?? (fight_active ? checkpoint : null)
