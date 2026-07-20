// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D4 regression fence — QUALITY TIERS ARE A DEAD CONCEPT.
// BoxReveal once rendered a quality badge + 'uncommon' fallbacks; the concept is purged. RevealStage is
// JSX and drags `../auth`→window at import, so it cannot be render-tested under bun:test — this fence
// checks the SOURCE for the exact residue classes that shipped the regression (tier text, tier tint,
// the tier badge, the quality fallback) plus the D3 "Later" ceremony this rewrite deleted.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BoxReveal.jsx'), 'utf8')

describe('BoxReveal has no quality-tier residue (D4)', () => {
  it('never falls back to or renders a tier', () => {
    expect(source).not.toMatch(/uncommon/)
    expect(source).not.toMatch(/boxreveal__badge/)
    expect(source).not.toMatch(/quality_color|rarity_tint|is_legendary/)
    expect(source).not.toMatch(/from '\.\/quality\.js'/)
  })

  it('keeps the pet name (the badge died, the name stays)', () => {
    expect(source).toMatch(/boxreveal__pet-name/)
  })

  it('has no "Later" ceremony — the claim is automatic (D3-REVISED)', () => {
    expect(source).not.toMatch(/lootbox\.later/)
  })
})
