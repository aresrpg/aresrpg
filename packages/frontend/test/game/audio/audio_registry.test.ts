// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'

import source from '../../../../../seed/content/spells.json'
import {
  AUDIO_ASSETS,
  AUTHORED_AUDIO,
  SPELL_AUDIO,
  dispose_audio,
  play_audio,
  preload_audio,
  sync_audio_volumes,
} from '../../../src/game/audio/audio_registry.ts'
import { set_master_audio_volume } from '../../../src/game/core/audio_volume.ts'
import { create_footsteps } from '../../../src/game/audio/footsteps.ts'
import settings_module from '../../../src/modules/settings.ts'
import { create_game_audio_observer } from '../../../src/modules/audio.ts'
import { initial_app_state, type AppState } from '../../../src/store.ts'

const original_audio = globalThis.Audio
const players: {
  source: string
  volume: number
  paused: boolean
  ended: boolean
  currentTime: number
  preload: string
  plays: number
  loads: number
  play: () => Promise<void>
  pause: () => void
  load: () => void
  removeAttribute: (name: string) => void
}[] = []

function mock_audio(source_url: string) {
  const player = {
    source: source_url,
    volume: 1,
    paused: true,
    ended: false,
    currentTime: 0,
    preload: '',
    plays: 0,
    loads: 0,
    play: async () => {
      player.plays += 1
      player.paused = false
    },
    pause: () => {
      player.paused = true
    },
    load: () => {
      player.loads += 1
    },
    removeAttribute: (_name: string) => {
      player.source = ''
    },
  }
  players.push(player)
  return player
}
const install = () => {
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: mock_audio })
  set_master_audio_volume(1)
}
afterEach(() => {
  dispose_audio()
  players.length = 0
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: original_audio })
  set_master_audio_volume(1)
})

test('authored spell assignments name real spells and registered sounds', () => {
  const names = new Set(source.map(({ name }) => name))
  Object.entries(SPELL_AUDIO).forEach(([name, key]) => {
    expect(names.has(name)).toBeTrue()
    expect(AUDIO_ASSETS[key]).toBeDefined()
  })
  expect(AUTHORED_AUDIO.fight_over?.file).toBe('fight_over.ogg')
  expect(AUTHORED_AUDIO.settings_changed?.file).toBe('settings_changed.ogg')
})

test('water entry uses the supplied recording once and obeys master mute', () => {
  install()
  const footsteps = create_footsteps(
    () => 0.5,
    () => null
  )
  const input = { position: [0, 1, 0] as const, on_ground: false, preset: 'water' as const, speed: 0 }
  footsteps.tick({ ...input, water_entered: true })
  footsteps.tick(input)
  footsteps.tick(input)
  expect(players).toHaveLength(1)
  expect(players[0]?.source).toBe('/sound_effect/water_enter.aac')
  expect(players[0]?.plays).toBe(1)
  set_master_audio_volume(0)
  footsteps.tick({ ...input, water_entered: true })
  expect(players[0]?.plays).toBe(1)
  expect(AUDIO_ASSETS.jump).toBeUndefined()
  expect(AUDIO_ASSETS.double_jump).toBeUndefined()
  footsteps.dispose()
})

test('muting prevents allocation and playback; master changes immediately affect active sounds', () => {
  install()
  set_master_audio_volume(0)
  play_audio('fight_over')
  expect(players).toHaveLength(0)
  set_master_audio_volume(0.5)
  play_audio('fight_over')
  expect(players[0]?.volume).toBeCloseTo(0.3)
  set_master_audio_volume(0)
  sync_audio_volumes()
  expect(players[0]?.volume).toBe(0)
})

test('preloading is reused and overlapping voices stay bounded', () => {
  install()
  preload_audio(['senshi_power', 'senshi_power'])
  expect(players).toHaveLength(1)
  expect(players[0]?.loads).toBe(1)
  for (let index = 0; index < 8; index += 1) play_audio('senshi_power')
  expect(players).toHaveLength(3)
  expect(players.reduce((sum, player) => sum + player.plays, 0)).toBe(3)
  players[0]!.ended = true
  play_audio('senshi_power')
  expect(players).toHaveLength(3)
  expect(players[0]?.plays).toBe(2)
  dispose_audio()
  expect(players.every(({ source: url, paused }) => url === '' && paused)).toBeTrue()
})

test('settings play only on explicit changed values and respect the new mute value', () => {
  install()
  let state: AppState = initial_app_state({
    quality: 'medium',
    music_enabled: true,
    render_distance: null,
    master_volume: 1,
  })
  const listeners = new Map<string, (...args: never[]) => void>()
  settings_module.observe({
    events: {
      on: (name, listener) => {
        listeners.set(name, listener as (...args: never[]) => void)
      },
    },
    get_state: () => state,
    dispatch: () => undefined,
    signal: new AbortController().signal,
  })
  const change = (settings: AppState['settings'], explicit = true): void => {
    const previous = state
    state = { ...state, settings }
    if (explicit) listeners.get('settings/changed')?.({ type: 'settings/changed', settings } as never)
    listeners.get('STATE_UPDATED')?.(state as never, previous as never)
  }
  change({ ...state.settings })
  expect(players).toHaveLength(0)
  change({ ...state.settings, music_enabled: false })
  expect(players[0]?.source).toBe('/sound_effect/settings_changed.ogg')
  change({ ...state.settings, master_volume: 0 })
  expect(players.reduce((sum, player) => sum + player.plays, 0)).toBe(1)
  expect(players[0]?.volume).toBe(0)
  change({ ...state.settings, quality: 'low', master_volume: 1 }, false)
  expect(players.reduce((sum, player) => sum + player.plays, 0)).toBe(1)
})

test('the shared settings lifecycle releases audio in demo and player runtimes', () => {
  install()
  const state = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const controller = new AbortController()
  settings_module.observe({
    events: { on: () => undefined },
    get_state: () => state,
    dispatch: () => undefined,
    signal: controller.signal,
  })
  play_audio('senshi_power')
  expect(players[0]?.paused).toBeFalse()
  controller.abort()
  expect(players[0]?.paused).toBeTrue()
  expect(players[0]?.source).toBe('')
})

test('the default game observer preserves authored volumes instead of passing cue indices', () => {
  install()
  let state = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
  let updated: ((state: AppState) => void) | undefined
  create_game_audio_observer()({
    events: {
      on: (name, listener) => {
        if (name === 'STATE_UPDATED') updated = listener as typeof updated
      },
    },
    get_state: () => state,
    dispatch: () => undefined,
    signal: new AbortController().signal,
  })
  const result = {
    fight: 'demo-fight',
    boss_weight: 0,
    dungeon: null,
    kolizeum: null,
    kolizeum_wager: null,
    winner: 0,
    duration_ms: 1000,
    gas_spent_mist: 0n,
    participants: [],
    own_seat: null,
    loot_types: [],
    settlement_confirmed: true,
    progression_synced: true,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
  }
  state = { ...state, adventure: { ...state.adventure, phase: 'reward', result } }
  updated!(state)
  expect(players).toHaveLength(1)
  expect(players[0]?.source).toBe('/sound_effect/fight_over.ogg')
  expect(players[0]?.plays).toBe(1)
  expect(players[0]?.volume).toBeCloseTo(AUTHORED_AUDIO.fight_over!.volume)
  state = {
    ...state,
    adventure: { ...state.adventure, result: { ...result, fight: 'another-fight' } },
    job_level_up: {
      current: {
        id: 'job-level',
        character_id: 'character',
        character_name: 'Player',
        job: 'BAKER',
        level_before: 1,
        level_after: 2,
      },
      queued: [],
    },
  }
  updated!(state)
  expect(players.map(({ volume }) => volume)).toEqual([0.6, 0.6, 0.5])
  updated!(state)
  expect(players.reduce((total, player) => total + player.plays, 0)).toBe(3)
})

test('rapid quest completions retrigger the chime without dropping cues or stacking voices', () => {
  install()
  for (let index = 0; index < 7; index += 1) play_audio('quest_completed')
  expect(players).toHaveLength(1)
  expect(players[0]?.plays).toBe(7)
  expect(players[0]?.source).toBe('/sound_effect/quest_completed.aac')
})
