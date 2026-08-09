// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Own file, not a block in seed_full_corpus.test.mjs: that suite reads the PRIVATE seed corpus
// (seed/mainnet/*.json), which this repo does not contain, so it cannot run here. This gate is pure — two
// source files and a regex — and must run everywhere, because the thing it guards is a publish-time cliff.

import fs from 'node:fs'

import { describe, expect, test } from 'bun:test'

// The 07-30 shrink demoted 51 `public fun` whose only callers were Move tests. Its caller census read Move
// sources and JS `target:` literals — and structurally could not see a target built by INTERPOLATED FUNCTION
// NAME. `resolveConsumableEffect` returns one of five names and PHASE 3 composes
// `${CITEMS}::consumable_effect::${ceff.fn}`, so three of the five (`bag_open`, `stat_reset`, `spell_reset`)
// were demoted to `#[test_only]` while the reseed still names them — a whole-PTB abort at the next ceremony.
//
// This is the CLASS gate, not the instance fix: every name that variable can hold must resolve to a live
// PUBLIC Move door. A future shrink that demotes one of them turns red here instead of at the ceremony.
describe('consumable-effect doors composed by interpolated name', () => {
  const seeder = fs.readFileSync(new URL('./seed_full_corpus.mjs', import.meta.url), 'utf8')
  const source = fs.readFileSync(new URL('../aresrpg/sources/consumable_effect.move', import.meta.url), 'utf8')

  // Every name the interpolation can hold: the two literal returns plus every CJSON_KIND value.
  const names = (() => {
    const literals = [...seeder.matchAll(/return \{ fn: '([a-z_]+)'/g)].map((m) => m[1])
    const [, block] = seeder.match(/const CJSON_KIND = \{([\s\S]*?)\n\}/)
    const mapped = [...block.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1])
    return [...new Set([...literals, ...mapped])].sort()
  })()

  test('the interpolation is still the five known kinds', () => {
    expect(seeder).toContain('::consumable_effect::${ceff.fn}')
    expect(names).toEqual(['bag_open', 'gacha_roll', 'heal', 'spell_reset', 'stat_reset'])
  })

  for (const name of names)
    test(`${name} is a live public door, not #[test_only]`, () => {
      const at = source.indexOf(`public fun ${name}(`)
      expect(at).toBeGreaterThan(-1)
      // the attribute, if any, sits on the line immediately above the declaration
      const above = source.slice(0, at).split('\n').at(-2) ?? ''
      expect(above).not.toContain('#[test_only]')
    })
})
