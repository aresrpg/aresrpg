// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import public_manifest from '../../../public/asset_manifest.json' with { type: 'json' }

import { resolve_mob_visual_url } from './mobs.js'

// MISSING-ARTIFACT (#117): scripts/walrus/registry.json is a Walrus-publish registry (content-pipeline
// tooling output), absent by design in this public repo.
const WALRUS_REGISTRY_PATH = fileURLToPath(new URL('../../../../../scripts/walrus/registry.json', import.meta.url))
const WALRUS_REGISTRY_AVAILABLE = existsSync(WALRUS_REGISTRY_PATH)
const walrus_registry = WALRUS_REGISTRY_AVAILABLE ? (await import('../../../../../scripts/walrus/registry.json')).default : null

describe('mob visual source SSOT', () => {
  test.skipIf(!WALRUS_REGISTRY_AVAILABLE)('the served mob quilt is the current uploaded registry quilt', () => {
    expect(public_manifest.classes.mob.quilt).toBe(walrus_registry.blobs.mob_glb_quilt.blob_id)
  })

  test('a late asset reconfiguration cannot split world and fight GLB URLs', () => {
    const cache = new Map()
    let quilt = 'MOB_A'
    const asset_url = (/** @type {string} */ _class, /** @type {string} */ file) => `https://assets.invalid/${quilt}/${file}`
    const world_url = resolve_mob_visual_url(cache, 'hy_rat', asset_url)
    quilt = 'MOB_B'
    const fight_url = resolve_mob_visual_url(cache, 'hy_rat', asset_url)
    expect(fight_url).toBe(world_url)
    expect(fight_url).toContain('/MOB_A/')
  })
})
