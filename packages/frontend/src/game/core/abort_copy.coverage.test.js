// DECODER-COVERAGE GATE (seat order 07-19 — recurrence→mechanism from the pet-equip class): a MoveAbort from an
// abort-capable Move module that the ONE decoder table (abort_copy.js TABLE) doesn't map renders the raw generic
// `tx_failed` line — exactly what item_stats::EInvalidScale did on a pet-equip. This gate ENUMERATES every
// abort-capable Move SOURCE module (a `const E…: u64` declaration = the module can abort with a code) and asserts
// each is CONSCIOUSLY classified: mapped in the decoder TABLE, or listed in GENERIC_BY_DESIGN below with a reason.
// A brand-new abort-capable module is in NEITHER → this test goes red → the author must map it or exclude it. That
// ratchet is the point: a future module can never silently ship a player surface that renders raw jargon.
//
// PROBE INTEGRITY (memory law): the enumeration is derived from the Move sources at test time (never a hand-copied
// list that rots), the include-set is stated (every abort-capable module minus the documented exclusions), and the
// positive controls below prove the grep actually found real modules on BOTH sides of the partition.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { decoder_covered_modules } from './abort_copy.js'

// packages/frontend/src/game/core → packages/move
const MOVE_ROOT = resolve(import.meta.dir, '../../../../move')

// Every `<pkg>/sources/**/*.move` (published code only — tests/ and build/ are excluded by the glob).
const source_files = [...new Bun.Glob('*/sources/**/*.move').scanSync({ cwd: MOVE_ROOT, absolute: true })]

const MODULE_RE = /\bmodule\s+\w+::(\w+)/
const ERROR_CONST_RE = /\bconst\s+E[A-Za-z0-9_]*\s*:\s*u64\b/

// bare module identifier (as a MoveAbort's MoveLocation reports it) → true when the file declares ≥1 error constant.
const abort_capable_modules = (() => {
  const set = new Set()
  for (const file of source_files) {
    const src = readFileSync(file, 'utf8')
    const mod = MODULE_RE.exec(src)?.[1]
    if (mod && ERROR_CONST_RE.test(src)) set.add(mod)
  }
  return set
})()

// GENERIC-BY-DESIGN — abort-capable modules whose codes are NOT player-surfaced, so falling to the honest generic
// line is correct. Each carries the reason (mirrors abort_copy.js's own "left generic with reason" discipline).
// Promote a row into the decoder TABLE (and off this list) the moment one of its aborts is proven to reach a player.
const GENERIC_BY_DESIGN = new Map([
  ['admin', 'owner/admin-only doors — never a player-signed tx'],
  ['pool', 'gifting reward-pool leaf — admin-seeded, no direct player door'],
  ['character_listing_rule', 'kiosk TransferPolicy rule — framework-internal (the `kiosk` arm surfaces kiosk aborts)'],
  ['item_listing_rule', 'kiosk TransferPolicy rule — framework-internal'],
  ['lot_rule', 'kiosk lot rule — framework-internal'],
  ['dungeon_lock', 'kiosk lock rule — framework-internal'],
  ['character_xp', 'internal XP-math leaf — no direct player door'],
  ['consumable_effect', 'effect-vocabulary authoring invariant (admin/seed)'],
  ['mob_template', 'admin mint invariants (MAX_SPELLS / MAX_LOOT)'],
  ['spell_template', 'spell authoring leaf (admin/seed)'],
  ['spell_bands', 'foundation spell-band math leaf — internal'],
  ['rune_catalog', 'foundation rune-catalog authoring leaf (admin/seed)'],
  ['taux', 'foundation rate-table math leaf — internal'],
  ['zone_gen', 'foundation zone-generation leaf — internal'],
  ['world', 'world authoring / zone-math / destroy_world — admin/internal invariants'],
  ['mob', 'engine mob-state leaf — internal'],
  ['mob_ai', 'engine AI leaf — internal'],
  ['movement', 'engine movement leaf (the `actions` arm surfaces the player move abort)'],
  ['displacement', 'engine displacement-math leaf — internal'],
  ['turns', 'engine turn-machine leaf (the `actions` arm surfaces player turn aborts)'],
  ['fight_marker', 'internal marker type (the `fight` 111 arm surfaces the marked-character case)'],
  ['friends', 'social friends-list refusals not yet surfaced in a client tx path — map when wired'],
  ['forgemagie', 'rune scribe/crush — client wiring unconfirmed this pass; map when a live door is proven to render generic'],
  ['commission', 'artisan-commission marketplace — client wiring unconfirmed this pass; map when a live door is proven'],
  ['results', 'fight-result mint/burn/open — the client orchestrates the flow; codes are defensive stale-races; map when a live one surfaces'],
])

describe('decoder-coverage gate: every abort-capable Move module is classified (mapped or generic-by-design)', () => {
  test('the enumeration actually found the Move sources (probe integrity)', () => {
    expect(source_files.length).toBeGreaterThan(30)
    expect(abort_capable_modules.size).toBeGreaterThan(30)
    // positive controls on BOTH sides of the partition — proves the grep found real modules, not an empty/typo set.
    expect(abort_capable_modules.has('creation')).toBe(true) // a MAPPED module
    expect(abort_capable_modules.has('item_stats')).toBe(true) // the pet-equip suspect (RED until mapped this pass)
    expect(abort_capable_modules.has('admin')).toBe(true) // a GENERIC_BY_DESIGN module
  })

  test('no module is BOTH mapped and excluded (one home per classification)', () => {
    const mapped = new Set(decoder_covered_modules())
    const dup = [...GENERIC_BY_DESIGN.keys()].filter((m) => mapped.has(m))
    expect(dup, `a module is both in the decoder TABLE and GENERIC_BY_DESIGN: ${dup.join(', ')}`).toEqual([])
  })

  test('every abort-capable Move module has a decoder row OR a documented generic-by-design reason', () => {
    const mapped = new Set(decoder_covered_modules())
    const uncovered = [...abort_capable_modules].filter((m) => !mapped.has(m) && !GENERIC_BY_DESIGN.has(m)).sort()
    // RED until item_stats (+ pet, stat_allocation) were mapped this pass. A NEW abort-capable module lands here
    // until it is either mapped in abort_copy.js or added to GENERIC_BY_DESIGN with a reason.
    expect(
      uncovered,
      `abort-capable Move modules with NO decoder row and NO generic-by-design reason: ${uncovered.join(', ')}`
    ).toEqual([])
  })
})
