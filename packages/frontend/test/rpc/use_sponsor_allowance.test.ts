// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2270 — the SERVED allowance must actually REACH the spend guard's breaker ceiling. The pure door
// (`spend_guard_note_allowance` → `automated_ceiling_mist`) was already proven by spend_guard.test.js, but a
// door nobody knocks on is a comment: until this wire existed, the ceiling stayed on its conservative fallback
// for the whole session while the sponsor served a cap 100× larger. `use_sponsor_allowance` is the ONE reader
// of `/v1/sponsor/remaining`, so it is the one place that can hand the number over.
//
// TWO assertions, because the wire has two halves and only one of them is executable here:
//   ① the derivation the effect performs (the poll's mist STRING → bigint → ceiling) is driven for real,
//     against the real door — a served 5 SUI cap must lift the ceiling off the fallback.
//   ② the wire itself is pinned as SHAPE. The call lives inside a React effect in a hook with early returns;
//     this package has no DOM/renderer harness that runs effects (react-dom/server does not), so the source is
//     the honest artifact — the same reason spawn_truth_sources.test.js pins its consumer wiring that way.
//     Deleting the effect, dropping the import, or passing something other than the served allowance reds this.

import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  AUTOMATED_SPEND_CEILING_FALLBACK_MIST,
  automated_ceiling_mist,
  reset_spend_guard,
  spend_guard_note_allowance,
  spend_guard_state,
} from '../../src/world-shell/spend_guard.js'

const hook_source = readFileSync(new URL('../../src/rpc/use_sponsor_allowance.ts', import.meta.url), 'utf8')

/** Exactly what /v1/sponsor/remaining serves: mist as a STRING (views.ts RpcSponsorRemaining). */
const SERVED_ALLOWANCE_MIST = '5000000000'

describe('#2270 the served allowance reaches the spend-guard ceiling', () => {
  beforeEach(() => {
    reset_spend_guard()
  })

  test('① the poll payload the hook holds lifts the breaker ceiling off its fallback', () => {
    expect(automated_ceiling_mist(spend_guard_state().allowance_mist)).toBe(AUTOMATED_SPEND_CEILING_FALLBACK_MIST)

    // The effect's exact derivation, driven against the real door.
    spend_guard_note_allowance(BigInt(SERVED_ALLOWANCE_MIST))

    expect(spend_guard_state().allowance_mist).toBe(5_000_000_000n)
    expect(automated_ceiling_mist(spend_guard_state().allowance_mist)).toBe(250_000_000n)

    // Logged out / first poll pending is honest null, never a stale high ceiling.
    spend_guard_note_allowance(null)
    expect(automated_ceiling_mist(spend_guard_state().allowance_mist)).toBe(AUTOMATED_SPEND_CEILING_FALLBACK_MIST)
  })

  test('② the hook is wired to the spend guard — it notes the served allowance in an effect', () => {
    expect(hook_source).toContain("import { spend_guard_note_allowance } from '../world-shell/spend_guard.js'")
    expect(hook_source).toMatch(/useEffect\(\(\) => \{\s*spend_guard_note_allowance\(/)
    // The value handed over is the SERVED one, decoded to bigint — never a restated constant.
    expect(hook_source).toMatch(/spend_guard_note_allowance\([^)]*BigInt\(served_allowance_mist\)\)/)
    expect(hook_source).toMatch(/const served_allowance_mist = data\?\.allowance_mist \?\? null/)
  })
})
