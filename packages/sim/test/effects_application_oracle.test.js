// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One ordinary test per registry kind. Missing application is intentionally RED.

import { describe, expect, test } from 'bun:test'

import { direct_consequence_entries } from './effect_consequence_direct_cases.js'
import { status_consequence_entries } from './effect_consequence_status_cases.js'
import {
  kind_name,
  source_kinds,
} from './seeded_spell_effect_conformance_matrix.js'

/** The oracle artifact: one expected observable consequence for every source-registry kind. */
export const expected_consequences = new Map([
  ...direct_consequence_entries,
  ...status_consequence_entries,
])

describe('effects-application oracle', () => {
  test('expected-consequence map covers the source registry exactly', () => {
    expect(
      [...expected_consequences.keys()].toSorted((left, right) => left - right),
    ).toEqual(source_kinds.map(([, kind]) => kind))
    expect(
      [...expected_consequences.entries()]
        .filter(([, row]) => row.description.length < 20)
        .map(([kind]) => kind_name(kind)),
    ).toEqual([])
  })

  for (const [, kind] of source_kinds) {
    const row = expected_consequences.get(kind)
    test(
      `${kind_name(kind)} — ${row?.description ?? 'MISSING CONSEQUENCE'}`,
      () => {
        expect(row, `${kind_name(kind)} has no consequence oracle`).toBeDefined()
        row.probe()
      },
    )
  }
})
