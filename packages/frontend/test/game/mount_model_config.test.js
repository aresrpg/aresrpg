// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { mount_is_flight, mount_model_config, mount_model_scale, mount_model_yaw } from '../../src/game/cosmetic_glb.js'
import { fast_travel_dragon_file } from '../../src/game/fast_travel_assets.js'

describe('mount model transform config', () => {
  // #2199: the live flight mount is the PUBLISHED dragon-fire key — the row it reads is the same one the
  // dragon size check gates, so its whole presentation size comes from MOUNT_TABLE, never a private multiplier.
  test('the live fast-travel dragon declares its facing flip in the published model row', () => {
    const url = '/models/mobs/dragon-fire.glb'

    expect(fast_travel_dragon_file()).toBe('dragon-fire.glb')
    expect(mount_model_config(url)).toEqual({ scale: 1, facing: Math.PI, flight: true })
    expect(mount_model_scale(url, 0.4)).toBeCloseTo(0.4)
    expect(mount_model_yaw(url, 0.25)).toBeCloseTo(Math.PI + 0.25)
    expect(mount_is_flight(url)).toBe(true)
  })

  test('the retired ln codename resolves nothing — no config row keeps it rideable', () => {
    expect(mount_model_config('/models/mobs/ln.glb')).toEqual({ scale: 1, facing: 0, flight: false })
  })

  test('an unconfigured mount keeps the shared attach transform unchanged', () => {
    const url = '/models/pet/corbac.glb'

    expect(mount_model_config(url)).toEqual({ scale: 1, facing: 0, flight: false })
    expect(mount_model_scale(url, 0.4)).toBe(0.4)
    expect(mount_model_yaw(url, 0.25)).toBe(0.25)
  })
})
