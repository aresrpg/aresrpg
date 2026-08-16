// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import mobs_source from '../../../../seed/content/mobs.json'

describe('mob models', () => {
  test('every mob owns exactly one mob_type-named GLB', () => {
    const model_dir = resolve(import.meta.dir, '../../../../seed/models/mobs')
    const model_types = readdirSync(model_dir)
      .filter((name) => name.endsWith('.glb'))
      .map((name) => name.slice(0, -4))
      .toSorted()
    const mob_types = mobs_source.map(({ mob_type }) => mob_type).toSorted()

    expect(mobs_source.every((mob) => !('appearance' in mob))).toBe(true)
    expect(model_types).toEqual(mob_types)
  })
})
