// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1603 — the shipped SDK catalog is a generated materialization of the Move tables, never authored twice.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  derive_forge_catalog,
} from '../scripts/generate_forge_catalog.mjs'
import catalog from '../src/forge_catalog.json' with { type: 'json' }

describe('#1603 forge catalog provenance', () => {
  test('the SDK corpus equals the rune_catalog.move declarations', () => {
    const source = readFileSync(
      new URL(
        '../../move/foundation/sources/rune_catalog.move',
        import.meta.url,
      ),
      'utf8',
    )

    expect(catalog).toEqual({
      _source: 'packages/move/foundation/sources/rune_catalog.move',
      ...derive_forge_catalog(source),
    })
  })
})
