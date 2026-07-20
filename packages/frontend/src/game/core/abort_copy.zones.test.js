// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENGAGE-GROUP GATE (leg ②) — the world-fight CLAIM door (`zones::claim_mob_group[_in_zone][_with_proof]`, the
// first call inside create_world_fight) has TWO first-come TOCTOU aborts a racing engage surfaces AFTER the S-54
// dry-run passed: ESpawnNotFound/108 (the group was claimed/consumed between poll and press — "already taken") and
// EBadGroupProof/110 (the supplied facts/index/proof no longer authenticate against the searched-zone root — the
// zone changed under you — stale proof). Both must reach the player as HONEST copy, never the raw generic tx blob.
// 108 was already mapped; 110 is the additive entry. Verified firsthand against packages/move/aresrpg/sources/
// zones.move (const ESpawnNotFound = 108; const EBadGroupProof = 110).
import { describe, expect, test } from 'bun:test'

import i18n from '../../i18n'

import { humanize_abort } from './abort_copy.js'

const grpc_abort = (module, code) => ({
  $kind: 'MoveAbort',
  MoveAbort: {
    abortCode: String(code),
    location: { package: '0x2476', module, function: 1, instruction: 1 },
  },
})

// [module, code, key] — both TOCTOU claim aborts map to honest, non-punitive "find another pack" copy.
const zones_keys = [
  ['zones', 108, 'errors.fight_group_claimed'], // ESpawnNotFound — the group was claimed/consumed first ("already taken")
  ['zones', 110, 'errors.fight_zone_changed'], // EBadGroupProof — stale proof vs the searched-zone root (the zone changed)
]

describe('zones claim-race abort copy (108 already taken / 110 zone changed)', () => {
  test('both codes humanize from structured AND executed-string receipts, never the generic blob', () => {
    for (const [module, code, key] of zones_keys) {
      const legacy = `MoveAbort(MoveLocation { module: ModuleId { name: Identifier("${module}") }, ... }, ${code}) ...`
      const mapped = i18n.t(key)
      // guard: a real mapped key never collapses to the generic fallback (proves the entry exists, not just "!==")
      expect(mapped).not.toBe(i18n.t('errors.tx_failed'))
      expect(humanize_abort(grpc_abort(module, code))).toBe(mapped)
      expect(humanize_abort(legacy)).toBe(mapped)
    }
  })

  test('an unmapped zones code still falls back to the honest generic line', () => {
    expect(humanize_abort(grpc_abort('zones', 101))).toBe(i18n.t('errors.tx_failed'))
  })
})
