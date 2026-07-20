// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT MUSIC = THE ARMED ZONE'S `_battle` TWIN: the battle bed is the zone's own twin — if the roam
// bed picked arctic for a biome, a battle in this biome plays arctic_battle. The twin invariant is a PURE
// property of resolve_tracks: roam `${name}.mp3` and battle `${name}_battle.mp3` come off the SAME
// track_for_biome name, so set_combat's crossfade can never play a foreign battle track. The crossfade itself
// (battle_cur ramp) is DOM wiring proven live by the headed dungeon runs — this file stays pure (no
// Audio/window/document), so there is nothing to mock and nothing to leak across test files.
//
// pick_random_biome pins the ROOT-CAUSE FIX for "fight music never starts" in a world fight: set_zone_music's
// only caller was dungeon_store's in_session latch, which world_fight.js deliberately never flips true for a
// world fight (it would wrongly force the dungeon's arctic bed) — so `started` stayed permanently false and
// set_combat's old `if (!started) return` silently no-op'd forever (reproduced live: no zone armed +
// set_combat(true) → zero Audio activity). set_combat now self-arms a random biome via this picker, whose OWN
// `_battle` twin then plays — region-consistent by construction.
import { describe, expect, it, afterEach } from 'bun:test'

import {
  hash_string,
  is_fight_music_enabled,
  is_music_enabled,
  pick_random_biome,
  resolve_tracks,
  set_fight_music_enabled,
  track_for_biome,
  TRACK_NAMES,
} from './ambient_music.js'

// A representative REAL biome-name sample — deliberately from BOTH vocabularies this hash actually receives
// in production: packages/engine's biome_registry.js terrain classification (17 entries) and the seeded
// mainnet worlds' on-chain `biome` field (seed/mainnet/*/world.json, 20 worlds) — proving more biomes than
// tracks resolves onto the 9-track pool without a curated row for any of them.
const REAL_BIOME_NAMES = [
  // biome_registry.js (terrain)
  'ocean',
  'beach',
  'river',
  'grassland',
  'temperate_forest',
  'dense_forest',
  'swamp',
  'taiga',
  'arctic',
  'glacier',
  'desert',
  'scorched_badlands',
  'tropical',
  'alpine',
  'crystal_hollows',
  'obsidian_spires',
  'void_marsh',
  // seed/mainnet/*/world.json (on-chain per-world biome)
  'archipelago',
  'canyon',
  'ash_steppe',
  'mesa',
  'magma_foundry',
  'pale_forest',
  'frost_lake',
  'reef_city',
  'glass_desert',
  'world_tree',
  'storm_plateau',
  'ashen_marsh',
  'sundered_waste',
  'volcanic_cathedral',
  'abyssal_forest',
  'celestial_ruin',
  'fractured_zenith',
  'floating_islands',
  'dead_calm_sea',
  // region-qualified zone keys (region_music.js `${world}:${region}` — coordinator ruling 2026-07-13):
  // the SAME hash pipeline + battle-twin invariant must hold for these richer identity strings.
  'charnel_marches:bone_flats',
  '02_verdant_hollow:cloud_forest',
  'everest:glacier',
]

describe('hash_string — deterministic FNV-1a string hash', () => {
  it('the same string always hashes to the same value', () => {
    for (const s of REAL_BIOME_NAMES) expect(hash_string(s)).toBe(hash_string(s))
  })

  it('never returns a negative number (uint32)', () => {
    for (const s of REAL_BIOME_NAMES) expect(hash_string(s)).toBeGreaterThanOrEqual(0)
  })

  it('different biome names usually hash differently (spot check, not a collision proof)', () => {
    expect(hash_string('archipelago')).not.toBe(hash_string('canyon'))
    expect(hash_string('arctic')).not.toBe(hash_string('tropical'))
  })
})

describe('track_for_biome — biome-name hash assignment (more biomes than musics: assign one per biome from biome name hash)', () => {
  it('is deterministic: the same biome name always resolves to the same track', () => {
    for (const biome of REAL_BIOME_NAMES) expect(track_for_biome(biome)).toBe(track_for_biome(biome))
  })

  it('every real biome name resolves into the owned TRACK_NAMES pool — never silent, never a curated row needed', () => {
    for (const biome of REAL_BIOME_NAMES) expect(TRACK_NAMES).toContain(track_for_biome(biome))
  })

  it('distributes across MORE THAN ONE track over the real biome list (never a single collapsed bucket)', () => {
    const assigned = new Set(REAL_BIOME_NAMES.map((b) => track_for_biome(b)))
    expect(assigned.size).toBeGreaterThan(1)
  })

  it('with an injected pool, picks by index exactly like pick_fight_track (same hash-mod-length contract)', () => {
    expect(track_for_biome('anything', ['only'])).toBe('only')
  })
})

describe('is_fight_music_enabled / set_fight_music_enabled — the separate FIGHT MUSIC settings toggle', () => {
  afterEach(() => set_fight_music_enabled(true)) // restore the shipped default so later tests see it enabled

  it("defaults to enabled (opt-OUT, not opt-in — today's behavior unchanged until the user disables it)", () => {
    expect(is_fight_music_enabled()).toBe(true)
  })

  it('disabling takes effect immediately', () => {
    set_fight_music_enabled(false)
    expect(is_fight_music_enabled()).toBe(false)
  })

  it('re-enabling restores it', () => {
    set_fight_music_enabled(false)
    set_fight_music_enabled(true)
    expect(is_fight_music_enabled()).toBe(true)
  })
})

describe('is_music_enabled — the SETTINGS-page reading of the music preference', () => {
  it('defaults to enabled', () => {
    expect(is_music_enabled()).toBe(true)
  })
})

describe('resolve_tracks — fight music is the ARMED ZONE\'s _battle twin (e.g. arctic→arctic_battle)', () => {
  it('roam and battle come off the SAME hash-assigned track name (the twin invariant)', () => {
    for (const biome of REAL_BIOME_NAMES) {
      const t = resolve_tracks(biome)
      expect(t).not.toBeNull()
      // battle URL is the roam URL with `.mp3` → `_battle.mp3` — never a foreign biome's battle track.
      expect(t.battle).toBe(t.roam.replace(/\.mp3$/, '_battle.mp3'))
      // and both carry the biome's own assigned track name (arctic → .../arctic.mp3 + .../arctic_battle.mp3).
      const name = track_for_biome(biome)
      expect(t.roam.endsWith(`/${name}.mp3`)).toBe(true)
      expect(t.battle.endsWith(`/${name}_battle.mp3`)).toBe(true)
    }
  })

  it('a falsy biome resolves to null (nothing to arm) — never throws', () => {
    expect(resolve_tracks('')).toBeNull()
  })

  it('the battle twin always ends in _battle.mp3 (a deployed fight loop, never silent)', () => {
    for (const biome of REAL_BIOME_NAMES) expect(resolve_tracks(biome).battle).toMatch(/_battle\.mp3$/)
  })
})

describe('pick_random_biome — set_combat self-arm pick (world-fight fix)', () => {
  it('with an injected rand of 0, picks the FIRST TRACK_NAMES member', () => {
    expect(pick_random_biome(() => 0)).toBe('arctic')
  })

  it('with an injected rand near 1, picks the LAST TRACK_NAMES member', () => {
    expect(pick_random_biome(() => 0.999999)).toBe('tropical')
  })

  it('defaults to Math.random and the LIVE TRACK_NAMES set — must return a known biome key, never throw', () => {
    const biome = pick_random_biome()
    expect(typeof biome).toBe('string')
    expect(biome.length).toBeGreaterThan(0)
  })

  it('every draw across many rolls stays a valid biome key (no out-of-range index)', () => {
    const known = new Set([
      'arctic',
      'desert',
      'glacier',
      'grassland',
      'scorched',
      'swamp',
      'taiga',
      'temperate',
      'tropical',
    ])
    for (let i = 0; i < 200; i++) {
      expect(known.has(pick_random_biome(() => i / 200))).toBe(true)
    }
  })
})
