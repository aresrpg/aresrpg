// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #94 regression: production shipped a Vite build whose seed-manifest glob matched zero files
// (the artifact was untracked), so the resolver threw `expected one seed manifest, found 0` at boot and
// the whole client crashed. The resolver must DEGRADE loudly on absence, never crash — while keeping the
// existing >1 guard and the exactly-one happy path.
import { describe, expect, spyOn, test } from 'bun:test'

import { resolve_seed_manifest } from './seed_manifest'

const one_manifest = { items: { sword: '0x1' }, mobs: {}, spells: {}, worlds: [] }

describe('resolve_seed_manifest — zero/one/many resolution (issue #94)', () => {
  test('zero manifests → degrades loudly (console.error) to an inert manifest, never throws', () => {
    const error_spy = spyOn(console, 'error').mockImplementation(() => {})
    let result: unknown
    expect(() => {
      result = resolve_seed_manifest({})
    }).not.toThrow()
    expect(result).toEqual({ items: {}, mobs: {}, spells: {}, worlds: [] })
    expect(error_spy).toHaveBeenCalledTimes(1) // no silent failure — the missing artifact is surfaced
    error_spy.mockRestore()
  })

  test('exactly one manifest → returned unchanged (happy path)', () => {
    expect(resolve_seed_manifest({ seed_manifest: one_manifest })).toBe(one_manifest)
  })

  test('more than one manifest → throws (existing guard preserved)', () => {
    expect(() => resolve_seed_manifest({ a: {}, b: {} })).toThrow('expected one seed manifest, found 2')
  })
})
