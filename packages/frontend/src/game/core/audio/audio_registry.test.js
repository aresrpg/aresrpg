// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

import {
  AUDIO_ASSETS,
  ELEMENT_AUDIO_VARIANTS,
  MUSIC_TRACK_NAMES,
  audio_asset_src,
  element_audio_key,
  element_audio_src,
  music_audio_key,
  play_audio,
} from './audio_registry.js'

const walk_files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk_files(full) : [full]
  })

describe('audio registry', () => {
  it('is the complete key → path home for the shipped SFX tree', () => {
    const public_sfx = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../public/sfx')
    const on_disk = walk_files(public_sfx)
      .map((file) => `/sfx/${path.relative(public_sfx, file)}`)
      .sort()
    const registered = Object.values(AUDIO_ASSETS)
      .filter((src) => src.startsWith('/sfx/'))
      .sort()

    expect(registered).toEqual(on_disk)
  })

  it('owns every elemental variant and every roam/battle music key', () => {
    for (const [family_layer, count] of Object.entries(ELEMENT_AUDIO_VARIANTS)) {
      const [family, layer] = family_layer.split(':')
      for (let variant = 1; variant <= count; variant += 1) {
        const key = element_audio_key(family, layer, variant)
        expect(AUDIO_ASSETS[key]).toBeTruthy()
        expect(element_audio_src(family, layer, variant)).toBe(AUDIO_ASSETS[key])
      }
    }
    for (const name of MUSIC_TRACK_NAMES)
      for (const bed of ['roam', 'battle']) expect(AUDIO_ASSETS[music_audio_key(name, bed)]).toBeTruthy()
  })

  it('rejects unknown keys without constructing media', async () => {
    expect(audio_asset_src('missing_sound')).toBeNull()
    await expect(play_audio('missing_sound')).resolves.toBeNull()
  })

  it('the play door preserves media success and rejection for the caller policy', async () => {
    const player = { play: () => Promise.resolve() }
    await expect(play_audio(/** @type {any} */ (player))).resolves.toBeUndefined()

    const error = new Error('autoplay blocked')
    const blocked = { play: () => Promise.reject(error) }
    await expect(play_audio(/** @type {any} */ (blocked))).rejects.toBe(error)
  })
})
