// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

import { decoder_covered_codes, decoder_covered_modules } from './abort_copy.js'

// packages/frontend/src/game/core → packages/move
const MOVE_ROOT = resolve(import.meta.dir, '../../../../move')

// Every `<pkg>/sources/**/*.move` (published code only — tests/ and build/ are excluded by the glob).
const source_files = [...new Bun.Glob('*/sources/**/*.move').scanSync({ cwd: MOVE_ROOT, absolute: true })]

const MODULE_RE = /\bmodule\s+\w+::(\w+)/
const CODE_RE = /\bconst\s+E[A-Za-z0-9_]*\s*:\s*u64\s*=\s*(\d+)/g
const ERROR_CONST_RE = /\bconst\s+E[A-Za-z0-9_]*\s*:\s*u64\b/

// module → the abort codes it declares. The gate classifies at CODE granularity: a MAPPED module carrying an
// UNMAPPED code is exactly how the raise-stat door fell back to generic copy after its codes were renumbered —
// module-granular coverage called that module "covered" and saw nothing.
const abort_codes_by_module = (() => {
  const map = new Map()
  for (const file of source_files) {
    const src = readFileSync(file, 'utf8')
    const mod = MODULE_RE.exec(src)?.[1]
    if (!mod) continue
    const codes = [...src.matchAll(CODE_RE)].map((match) => Number(match[1]))
    if (codes.length) map.set(mod, new Set([...(map.get(mod) ?? []), ...codes]))
  }
  return map
})()

// RATCHET baseline (same idiom as GENERIC_BY_DESIGN above): codes of MAPPED modules that are deliberately
// unmapped today — defensive races the UI pre-checks, admin-only invariants, engine internals. It never grows
// silently: a NEW or RENUMBERED code on a mapped module lands outside it and this gate goes red.
const GENERIC_CODES = new Map([
  ['actions', new Set([102, 103, 107])], // 102=ENotParticipant, 103=ENotYourCharacter, 107=EActorDead
  ['cast', new Set([108, 109])], // 108=EMissingRequiredState, 109=EForbiddenStatePresent
  ['character', new Set([101, 102, 103, 104, 105])], // 101=EPledgeMismatch, 102=ENotPersonalKiosk, 103=EEmptyZone, 104=EInvalidColor, 105=EAnchorNotIncreasing
  ['character_link', new Set([103, 104, 106, 107, 108, 109, 110, 120, 121, 122, 130, 131])], // 103=EUnknownClass, 104=ENonStackableQtyGtOne, 106=EConsumeTemplateMismatch, 107=EConsumeExceedsStack, 108=EZeroConsume, 109=EWrongDungeonWorld, 110=EWrongDungeonPass, 120=EAlreadyLocked, 121=ENotLocked, 122=EWrongLock, 130=EBadStat, 131=EZeroPoints
  ['config', new Set([102, 103])], // 102=EBadClass, 103=EDomainDisabled
  ['consume', new Set([102, 103, 104, 105])], // 102=ENotConsumable, 103=EUnsupportedEffect, 104=EZeroQuantity, 105=ELevelTooLow
  ['crafting', new Set([105, 106, 107, 108])], // 105=ELengthMismatch, 106=EEmptyRecipe, 107=EZeroQuantity, 108=EUnderLevel
  ['creation', new Set([109, 110, 111])], // 109=ENotZkLoginAddress, 110=ENotAppSponsored, 111=EFreeDisabled
  ['dungeon', new Set([105, 106, 108])], // 105=EBadRoom, 106=EEmptyRoom, 108=ERoomNotHomogeneous
  ['fight', new Set([105, 109, 110, 112, 113, 114, 115])], // 105=EBadStartCells, 109=EGatedJoins, 110=EBadTeam, 112=EWrongBrand, 113=ERosterFull, 114=EWrongMember, 115=EPartialRoster
  ['gathering', new Set([108])], // 108=EWrongProtector
  ['item', new Set([120, 121, 130, 131])], // 120=ELotInvalid, 121=ELotWrongItem, 130=EListingZeroAmount, 131=EListingWrongItem
  ['kolizeum', new Set([109, 111, 112, 113, 114, 115, 116, 117])], // 109=ENotFriendListOwner, 111=ENotCreator, 112=ENotStarted, 113=EBadSide, 114=ENoWinners, 115=ENotSweepable, 116=EWrongFight, 117=EWrongOutcomeBrand
  ['pet', new Set([102, 103, 106, 107, 108, 109, 110])], // 102=ENotPet, 103=EUseFeedPet, 106=ETemplateMismatch, 107=ETemplateHasNoStats, 108=EInvalidFoodPower, 109=ESameItem, 110=EWrongBurnAmount
  ['run', new Set([101, 102, 103, 106, 107])], // 101=EWrongRoom, 102=ENotOwner, 103=ENotSingleKeyUnit, 106=EWrongFight, 107=EWrongCharacter
  ['settlement', new Set([101, 104, 105, 106])], // 101=ENotTerminal, 104=ENotSweepable, 105=ENotExpired, 106=EReadySeat
  ['shop', new Set([108, 109, 110])], // 108=EStackableHasRanges, 109=EBadWindow, 110=ESaleNotPaused
  ['spell_book', new Set([201, 202])], // 201=EWrongLevelCount, 202=ELevelOutOfRange
  ['turns', new Set([102, 103, 104, 105, 106, 107, 108])], // 102=ENotYourCharacter, 103=ENotParticipant, 104=EBadStartCell, 105=ENotActive, 106=ENotYourTurn, 107=ENotYetExpired, 108=ESomeoneOverdue
  ['version', new Set([105])], // 105=ECharacterTypeAlreadySet — the one-time brand pin, an admin-only door (103/104 mapped by #1135)
  ['world', new Set([101, 102, 103, 104, 199])], // 101=EOutOfBounds, 102=EBadEntryIndex, 103=EBadRange, 104=EWorldNotEmpty, 199=EWrongInnerVersion
  ['zones', new Set([101, 102, 103, 105, 106, 107, 109, 111, 112, 113])], // 101=ELevelTooLow, 102=ENotInWorld, 103=ENoCheckpoint, 105=EZoneFresh, 106=EBadNode, 107=ENodeEmpty, 109=EBadDrainInput, 111=EGroupNotConsumed, 112=EMemberZone, 113=ENotMemberZone
])

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
  // `item_listing_rule` / `lot_rule` merged into `item`, `dungeon_lock` + `stat_allocation` into
  // `character_link`, `checkpoint` into `world` (republish restructure) — their codes are classified under the
  // host module now, so the retired names are gone from this map rather than lingering as dead rows.
  ['character_xp', 'internal XP-math leaf — no direct player door'],
  ['consumable_effect', 'effect-vocabulary authoring invariant (admin/seed)'],
  ['mob_template', 'admin mint invariants (MAX_SPELLS / MAX_LOOT)'],
  ['spell_template', 'spell authoring leaf (admin/seed)'],
  ['spell_bands', 'foundation spell-band math leaf — internal'],
  ['rune_catalog', 'foundation rune-catalog authoring leaf (admin/seed)'],
  ['taux', 'foundation rate-table math leaf — internal'],
  ['zone_gen', 'foundation zone-generation leaf — internal'],
  ['mob', 'engine mob-state leaf — internal'],
  ['mob_ai', 'engine AI leaf — internal'],
  ['movement', 'engine movement leaf (the `actions` arm surfaces the player move abort)'],
  ['displacement', 'engine displacement-math leaf — internal'],
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

  test('every abort CODE of a mapped module is mapped or baselined (code granularity)', () => {
    const mapped = decoder_covered_codes()
    const uncovered = []
    for (const [module_name, codes] of abort_codes_by_module) {
      if (!mapped[module_name] || GENERIC_BY_DESIGN.has(module_name)) continue
      for (const code of codes)
        if (!mapped[module_name].has(code) && !GENERIC_CODES.get(module_name)?.has(code))
          uncovered.push(`${module_name}::${code}`)
    }
    expect(
      uncovered.sort(),
      `mapped modules carrying an UNMAPPED abort code (renumbered door? new code?): ${uncovered.join(', ')}`
    ).toEqual([])
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
