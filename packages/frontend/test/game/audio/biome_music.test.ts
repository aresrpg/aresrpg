// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  biome_music_pair,
  biome_music_position,
  biome_music_track,
  follow_biome_music,
  initial_biome_music_follow,
  MUSIC_TRACKS,
} from '../../../src/game/audio/biome_music.ts'

describe('biome music', () => {
  test('every registered pair exists in the tracked soundtrack corpus', async () => {
    const music_dir = new URL('../../../../../music/', import.meta.url)

    for (const track of MUSIC_TRACKS) {
      expect(await Bun.file(new URL(`${track}.mp3`, music_dir)).exists()).toBe(true)
      expect(await Bun.file(new URL(`${track}_battle.mp3`, music_dir)).exists()).toBe(true)
    }
  })

  test('assigns one stable soundtrack pair to each world biome', () => {
    const key = '01_first_shore:shore_plains'
    const track = biome_music_track(key)

    expect(MUSIC_TRACKS.some((candidate) => candidate === track)).toBe(true)
    expect(biome_music_track(key)).toBe(track)
    expect(biome_music_pair(key)).toEqual({
      roam: `/music/${track}.mp3`,
      battle: `/music/${track}_battle.mp3`,
    })
  })

  test('distributes biome identities across the owned soundtrack pool', () => {
    const tracks = new Set(
      ['shore_plains', 'chalk_headland', 'drowned_nave', 'sunspire_dunes', 'gods_maw'].map((biome) =>
        biome_music_track(`world:${biome}`)
      )
    )

    expect(tracks.size).toBeGreaterThan(1)
  })

  test('Nauvis gives every authored biome a distinct track, including Plains and Highlands', () => {
    const keys = ['plains', 'forest', 'rainforest', 'highlands', 'desert', 'ocean'].map((biome) => `nauvis:${biome}`)
    const tracks = keys.map((key) => biome_music_track(key, keys))

    expect(new Set(tracks).size).toBe(keys.length)
    expect(biome_music_track('nauvis:plains', keys)).toBe('grassland')
    expect(biome_music_track('nauvis:highlands', keys)).toBe('taiga')
    expect(tracks[keys.indexOf('nauvis:plains')]).not.toBe(tracks[keys.indexOf('nauvis:highlands')])
  })

  test('arms immediately and rejects a flapping biome border', () => {
    const shore = follow_biome_music(initial_biome_music_follow(), 'world:shore', 3)
    const hill_once = follow_biome_music(shore, 'world:hill', 3)
    const shore_again = follow_biome_music(hill_once, 'world:shore', 3)
    const hill_twice = follow_biome_music(follow_biome_music(shore_again, 'world:hill', 3), 'world:hill', 3)
    const hill_confirmed = follow_biome_music(hill_twice, 'world:hill', 3)

    expect(shore.armed).toBe('world:shore')
    expect(shore_again).toEqual(shore)
    expect(hill_twice.armed).toBe('world:shore')
    expect(hill_confirmed.armed).toBe('world:hill')
  })

  test('switches after the configured run of stable pose samples', () => {
    const shore = follow_biome_music(initial_biome_music_follow(), 'world:shore', 3)
    const hill = ['world:hill', 'world:hill', 'world:hill'].reduce(
      (state, sample) => follow_biome_music(state, sample, 3),
      shore
    )

    expect(hill.armed).toBe('world:hill')
  })

  test('uses the checkpoint biome when reloading directly into a fight', () => {
    const checkpoint = Object.freeze({ x: -210, z: 139 })

    expect(biome_music_position(null, true, checkpoint)).toBe(checkpoint)
    expect(biome_music_position(null, false, checkpoint)).toBeNull()
    expect(biome_music_position({ x: 4, z: 8 }, true, checkpoint)).toEqual({ x: 4, z: 8 })
  })
})
