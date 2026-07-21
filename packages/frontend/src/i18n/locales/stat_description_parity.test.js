// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — the stats.description.* bundle (the one-line "what this stat actually does" copy under
// each CHARACTERISTICS row — packages/frontend/src/game/screens/hud/Stats.jsx). The 6-locale law (CLAUDE.md):
// every user-facing string lands in ALL locales; a missing/empty locale would print the raw key. This pins
// presence + non-emptiness across all six, mechanically, for every stat row the panel renders: the six
// allocatable primaries plus the two visible secondaries (Critical Hit, Raw Damage — SECONDARY_KEYS in
// Stats.jsx excludes every other equipment-only stat). Every key was RED before the feature landed.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

// Exactly the keys Stats.jsx's PRIMARY array + SECONDARY_KEYS allow-list render a row for.
const KEYS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'critical_hit',
  'raw_damage',
]

describe('i18n · stats.description.* present + non-empty in ALL 6 locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty stats.description.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.stats?.description?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }
})
