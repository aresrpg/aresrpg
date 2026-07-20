import { create } from 'zustand'

import { game_log } from './core/log.js'
import { resolve_world_biome } from './world-shell/world_biome.js'

// FOLLOW — the single source of truth for the idle-exploration "follow a character" view.
//
// DEFAULT (active=false): the game-world shows the decorative RANDOM-TERRAIN backdrop — no character
// focus, no biome music (GameWorldHost mounts roam({ decorative:true })). Calling follow() enters FOLLOW:
// GameWorldHost re-mounts the scene focused on the character (roam({ follow:true }) — the avatar visibly
// wanders its world, the camera trails it) and that World's BIOME MUSIC turns ON here. unfollow() returns
// to the backdrop and stops the zone music.
//
// The HUD's Follow / Unfollow control calls follow() / unfollow(); GameWorldHost subscribes to re-mount.
// The MUSIC lives HERE (one home, off the renderer) and is loaded from the game chunk LAZILY so (a) the
// eager bundle stays clean and (b) the parallel-built ambient_music API is called defensively — the build
// stays green even before set_zone_music / stop_zone_music land in ambient_music.js.

// A minimal character descriptor the roam scene can render (mirrors what game/embed.js mount_scene already
// consumes). Null = follow the player's currently-selected roster character (GameWorldHost's fallback).
export type FollowCharacter = {
  classe?: string
  class_id?: string
  male?: boolean
  name?: string
  level?: number | null
  experience?: number
  color_1?: number
  hue?: number
} | null

// The world's REAL on-chain biome (world.move's `biome: String` field) — resolved through the /v1
// encyclopedia worlds view via world_biome.js's `resolve_world_biome`, the SAME resolver embed_voxel.js's
// engine-recipe pick already uses (one home for world_id -> chain biome, no second lookup table —
// REUSE-FIRST). Falls back to DEFAULT_BIOME for a null world_id, a world absent from the encyclopedia
// (unseeded), or a failed read — ambient_music's track_for_biome hash-assigns EVERY biome string onto an
// owned track (MUSIC LAW: no silence fallback), so this default still plays music, just
// the shared fallback's pick.
const DEFAULT_BIOME = 'arctic'
export async function world_to_biome(world_id: string | null): Promise<string> {
  if (!world_id) return DEFAULT_BIOME
  const biome = await resolve_world_biome(world_id)
  return biome ?? DEFAULT_BIOME
}

// Defensive, lazy bridge to the (parallel-built) biome-music API in ambient_music.js. A dynamic import
// keeps this off the eager bundle AND tolerates the exports not existing yet (optional-call no-op), so we
// never statically import a not-yet-exported symbol (which would break `vite build`). Exported so
// GameWorldHost.tsx can arm/disarm the SAME zone bed for the resident lobby session (MUSIC GAP FIX
// 2026-07-13: the lobby — the actual played-character world, not this follow view — never armed a zone at
// all; only follow/dungeon did, so normal play was silent by omission, not by design). One bridge, two
// callers — never a second dynamic-import copy.
export async function zone_music(action: 'set' | 'stop', biome?: string): Promise<void> {
  try {
    const m = (await import('./game/core/audio/ambient_music.js')) as {
      set_zone_music?: (biome: string) => void
      stop_zone_music?: () => void
    }
    if (action === 'set' && biome) m.set_zone_music?.(biome)
    else if (action === 'stop') m.stop_zone_music?.()
  } catch (error) {
    game_log('follow', 'zone-music bridge failed', error)
  }
}

interface FollowState {
  active: boolean
  character: FollowCharacter
  world_id: string | null
  biome: string | null
  // Enter FOLLOW: focus + idle-wander `character` (null → the player's selected roster character) and turn
  // on `world_id`'s biome music. Idempotent re-call updates the target + re-cues the music.
  follow: (character: FollowCharacter, world_id: string | null) => void
  // Exit FOLLOW: back to the random-terrain backdrop + stop the zone music.
  unfollow: () => void
}

export const use_follow = create<FollowState>((set, get) => ({
  active: false,
  character: null,
  world_id: null,
  biome: null,
  follow: (character, world_id) => {
    set({ active: true, character, world_id, biome: null })
    void (async () => {
      const biome = await world_to_biome(world_id)
      if (get().world_id !== world_id) return // superseded by a later follow() call mid-resolve
      set({ biome })
      void zone_music('set', biome)
    })()
  },
  unfollow: () => {
    set({ active: false, character: null, world_id: null, biome: null })
    void zone_music('stop')
  },
}))

// DEV reach (testnet/dev only, absent from prod): toggle the follow view from the console without the HUD
// button wired yet — `__ARES_FOLLOW.follow('<world_id>')` / `.unfollow()`. Pure store calls, no bypass.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ARES_FOLLOW?: unknown }).__ARES_FOLLOW = {
    follow: (world_id: string | null = null, character: FollowCharacter = null) =>
      use_follow.getState().follow(character, world_id),
    unfollow: () => use_follow.getState().unfollow(),
  }
}
