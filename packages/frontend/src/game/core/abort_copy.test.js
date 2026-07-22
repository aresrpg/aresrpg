// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #55 — proves abort humanization survives the #23 gRPC cutover: the Core receipt's `effects.status.error` is a
// STRUCTURED object `{ $kind:'MoveAbort', MoveAbort:{ abortCode, location:{ module } } }` (parseGrpcExecutionError),
// NOT the legacy JSON-RPC abort STRING — the string-only regex used to collapse it to "[object Object]". These
// vectors mirror the EXACT shape a live simulate of character_upgrade_spell returned (abort 205 in spell_book).
import { describe, expect, test } from 'bun:test'
import i18n from '../../i18n'

import {
  parse_move_abort,
  humanize_abort,
  humanize_tx_error,
  is_preflight_refusal,
  is_equip_state_refusal,
  tx_error,
  on_marker_refusal,
  on_maintenance_abort,
} from './abort_copy.js'
import { use_toast } from '../../toast'

// The exact gRPC Core structured error (verified live: MoveAbort 205 in spell_book::upgrade).
const grpc_abort = (module, code) => ({
  $kind: 'MoveAbort',
  message: `MoveAbort in 2nd command, abort code: ${code}, in '0x2476::${module}::upgrade' (instruction 63)`,
  command: 1,
  MoveAbort: {
    abortCode: String(code),
    location: { package: '0x2476', module, function: 10, instruction: 63, functionName: 'upgrade' },
  },
})

describe('parse_move_abort — both the gRPC structured object AND the legacy string', () => {
  test('gRPC structured object → { module, code, package } (the shape run_tx now hands humanize_abort)', () => {
    // `package` (location.package) now rides along — it scopes the M1 base-abort copy so the shared `item`/
    // `admin` module names never collide with the legacy lineage's same-named modules.
    expect(parse_move_abort(grpc_abort('spell_book', 205))).toEqual({
      module: 'spell_book',
      code: 205,
      package: '0x2476',
    })
    expect(parse_move_abort(grpc_abort('spell_book', 204))).toEqual({
      module: 'spell_book',
      code: 204,
      package: '0x2476',
    })
    expect(parse_move_abort(grpc_abort('character', 109))).toEqual({
      module: 'character',
      code: 109,
      package: '0x2476',
    })
  })

  test('legacy string form still parses (our own re-throws / stringified receipts)', () => {
    const legacy = 'MoveAbort(MoveLocation { module: ModuleId { name: Identifier("dungeon_cast") }, ... }, 118) ...'
    expect(parse_move_abort(legacy)).toEqual({ module: 'dungeon_cast', code: 118 })
  })

  test('non-abort input → null (plain human message, gas blob, null)', () => {
    expect(parse_move_abort('That character is busy right now')).toBeNull()
    expect(parse_move_abort(null)).toBeNull()
    expect(parse_move_abort(undefined)).toBeNull()
  })

  // TERMINAL-RACE classification: post-victory begin_action 101 → a scary error toast for nothing.
  // dungeon_store.commit_turn swallows a benign `aresrpg_fight::actions` ENotActive (101) — the killing blow
  // already ended the fight, so the batch's trailing act_pass hit a non-active fight. The swallow keys off
  // parse_move_abort classifying it EXACTLY as { module: 'actions', code: 101 } — in BOTH shapes a tx path throws
  // (the structured gRPC receipt AND the legacy string carried on the error's `.cause`).
  test('the terminal-race abort classifies as actions/101 (structured, string, and via .cause)', () => {
    expect(parse_move_abort(grpc_abort('actions', 101))).toEqual({ module: 'actions', code: 101, package: '0x2476' })
    const legacy = 'MoveAbort(MoveLocation { module: ModuleId { name: Identifier("actions") }, ... }, 101) ...'
    expect(parse_move_abort(legacy)).toEqual({ module: 'actions', code: 101 })
    // the one-home throw (tx_error) preserves the raw abort on `.cause` while `.message` is already player copy —
    // parse_move_abort must still dig it out so the swallow keeps working.
    expect(parse_move_abort(tx_error(grpc_abort('actions', 101)))).toEqual({
      module: 'actions',
      code: 101,
      package: '0x2476',
    })
  })
})

describe('humanize_abort — spell_book gates 203-206 map to player copy, never "[object Object]"', () => {
  for (const [code, key] of [
    [203, 'errors.spell_not_learned'],
    [204, 'errors.spell_maxed'],
    [205, 'errors.spell_no_points'],
    [206, 'errors.spell_char_level'],
  ]) {
    test(`spell_book ${code} → ${key}`, () => {
      const out = humanize_abort(grpc_abort('spell_book', code))
      expect(out).toBe(i18n.t(key))
      expect(out).not.toBe('[object Object]')
      expect(out).not.toBe(i18n.t('errors.tx_failed'))
    })
  }

  test('an unmapped abort object degrades to the generic line, never raw', () => {
    expect(humanize_abort(grpc_abort('spell_book', 999))).toBe(i18n.t('errors.tx_failed'))
  })

  test('our own human throws pass through untouched', () => {
    expect(humanize_abort('That character is busy and cannot use items right now')).toBe(
      'That character is busy and cannot use items right now'
    )
  })
})

// The blocking bug: a non-abort object error (gRPC/network/gas payload) reached raw stringification and
// surfaced the literal "[object Object]", hiding the real commit-failure cause. humanize_tx_error is the ONE
// home that must never do that — across EVERY shape a tx path can throw.
describe('humanize_tx_error — the four shapes, NEVER "[object Object]"', () => {
  test('(1) structured MoveAbort object → mapped player copy', () => {
    expect(humanize_tx_error(grpc_abort('spell_book', 205))).toBe(i18n.t('errors.spell_no_points'))
  })

  test('(2) a plain Error (human message) passes through', () => {
    expect(humanize_tx_error(new Error('That character is not in your kiosk'))).toBe(
      'That character is not in your kiosk'
    )
  })

  test('(3) a bare string passes through', () => {
    expect(humanize_tx_error('No personal kiosk found')).toBe('No personal kiosk found')
  })

  test('(4) an arbitrary object payload → a truncated JSON dump, NEVER "[object Object]"', () => {
    const out = humanize_tx_error({ code: 'InternalError', detail: { retryable: false, nested: { a: 1 } } })
    expect(out).not.toBe('[object Object]')
    expect(out.length).toBeGreaterThan(0)
  })

  test('a GraphQL error array → the first message, jargon-gated', () => {
    expect(humanize_tx_error({ errors: [{ message: 'Rate limited, slow down' }] })).toBe('Rate limited, slow down')
  })

  test('null / undefined / {} never yield "[object Object]" — degrade to the generic line', () => {
    for (const v of [null, undefined, {}]) {
      const out = humanize_tx_error(v)
      expect(out).not.toBe('[object Object]')
      expect(out).toBe(i18n.t('errors.tx_failed'))
    }
  })
})

// F4/F5 E2E pass: fight create/join refusals (dungeon_actions.js's create_world_fight / join_world_fight / the
// dungeon next_fight+join_fight doors) — the "fight" module identifier is shared by the core game wrapper
// (aresrpg::fight) AND the generic combat engine (aresrpg_fight::fight); both packages' live codes map here.
describe('humanize_abort — fight create/join refusals (F4/F5)', () => {
  test('111 ECharacterMarked (core aresrpg::fight) → the P1 finding: an unopened FightResult blocks re-seating', () => {
    const out = humanize_abort(grpc_abort('fight', 111))
    expect(out).toBe(i18n.t('errors.fight_unclaimed_result'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('106/107 (core aresrpg::fight) — wrong world / wrong template share the "refresh & retry" copy', () => {
    expect(humanize_abort(grpc_abort('fight', 106))).toBe(i18n.t('errors.fight_world_changed'))
    expect(humanize_abort(grpc_abort('fight', 107))).toBe(i18n.t('errors.fight_world_changed'))
  })

  test('101/102/103/104/108 (engine aresrpg_fight::fight) — 0 HP / team full / already started / wrong party / already seated', () => {
    expect(humanize_abort(grpc_abort('fight', 101))).toBe(i18n.t('errors.fight_zero_hp'))
    expect(humanize_abort(grpc_abort('fight', 102))).toBe(i18n.t('errors.fight_team_full'))
    expect(humanize_abort(grpc_abort('fight', 103))).toBe(i18n.t('errors.fight_already_started'))
    expect(humanize_abort(grpc_abort('fight', 104))).toBe(i18n.t('errors.fight_wrong_party'))
    expect(humanize_abort(grpc_abort('fight', 108))).toBe(i18n.t('errors.fight_already_seated'))
  })

  test('an unmapped "fight" code (112 — the core/engine collision, both meanings unreachable live) degrades generic', () => {
    expect(humanize_abort(grpc_abort('fight', 112))).toBe(i18n.t('errors.tx_failed'))
  })

  test('fight_registry 103 ECharacterInFight — a DIFFERENT module than "fight", no collision', () => {
    expect(humanize_abort(grpc_abort('fight_registry', 103))).toBe(i18n.t('errors.fight_character_busy'))
  })

  test("zones 108 ESpawnNotFound — the [R] engage door raced another player's claim on the same spawn", () => {
    expect(humanize_abort(grpc_abort('zones', 108))).toBe(i18n.t('errors.fight_group_claimed'))
  })
})

// S-80 — the fight-forfeit door (`aresrpg_fight::actions::abandon`, ENGINE). Module "actions" is shared with
// act_move/act_weapon/act_cast/act_pass. 104 EIllegalMove IS mapped now — the mid-fight-refresh 104
// (actions.move:39 `cost <= mp`, root-fixed in fight_bridge); 102/103 stay generic (no live door reaches
// them). Plus the abandon-specific pair (105/106). #515 — 101 ENotActive is mapped too: the deadline
// auto-commit's own terminal-race guard is stale-read-only, so a killing blow landing a moment early still
// lets begin_action fire into an already-ended fight; the honest copy replaces the old generic scare line.
describe('humanize_abort — fight-forfeit door (S-80, aresrpg_fight::actions)', () => {
  test('104 EIllegalMove — the mid-fight-refresh 104: honest stale-board copy, no longer generic', () => {
    const out = humanize_abort(grpc_abort('actions', 104))
    expect(out).toBe(i18n.t('errors.fight_stale_board'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('105 EFightOver — abandon: the fight is already terminal, nothing left to forfeit', () => {
    const out = humanize_abort(grpc_abort('actions', 105))
    expect(out).toBe(i18n.t('errors.abandon_fight_over'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('106 EAlreadyDead — abandon: idempotence guard on an already-dead seat', () => {
    expect(humanize_abort(grpc_abort('actions', 106))).toBe(i18n.t('errors.abandon_already_dead'))
  })

  test('101 ENotActive — the deadline auto-commit terminal race: honest "fight no longer active" copy, no longer generic', () => {
    const out = humanize_abort(grpc_abort('actions', 101))
    expect(out).toBe(i18n.t('errors.fight_not_active'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('108 ETurnTooFast — instant-pass bot guard: the turn ended before MIN_TURN_MS (3s)', () => {
    const out = humanize_abort(grpc_abort('actions', 108))
    expect(out).toBe(i18n.t('errors.turn_too_fast'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('107 EActorDead (unreachable through a live door) still degrades generic', () => {
    expect(humanize_abort(grpc_abort('actions', 107))).toBe(i18n.t('errors.tx_failed'))
  })
})

// Combat-engine cast door (`aresrpg_fight::cast::act_cast`, ENGINE — the LIVE [1-9] spell-cast action). Module
// "cast" is DISTINCT from the retired "dungeon_cast" M1 lineage above (parse-level test, no humanize collision).
// 101/102/105 reuse dungeon_cast's already-mapped copy (AP / illegal-target / cooldown, one home); 104 reuses the
// spell_level-arm precedent (a foreign-class spell reads "not learned"); 103/106 are the NEW per-turn/per-target
// cast-cap copy (spell_bands casts_per_turn/casts_per_target — DungeonBoard.jsx pre-checks both client-side, so
// a live abort here is a stale-client race backstop).
describe('humanize_abort — fight-cast door (aresrpg_fight::cast, act_cast)', () => {
  test("101 EInsufficientAP — ap < the level's ap_cost (same copy as dungeon_cast/115)", () => {
    expect(humanize_abort(grpc_abort('cast', 101))).toBe(i18n.t('errors.cast_no_ap'))
  })

  test('102 EIllegalCast — can_cast_at rejects range/LOS/occupancy (same copy as dungeon_cast/114)', () => {
    expect(humanize_abort(grpc_abort('cast', 102))).toBe(i18n.t('errors.cast_illegal_target'))
  })

  test('103 ECastsPerTurn — already cast this spell casts_per_turn times this turn (NEW)', () => {
    const out = humanize_abort(grpc_abort('cast', 103))
    expect(out).toBe(i18n.t('errors.cast_per_turn_limit'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('104 ENotClassSpell — a foreign-class spell (same copy as spell_level/101)', () => {
    expect(humanize_abort(grpc_abort('cast', 104))).toBe(i18n.t('errors.spell_not_learned'))
  })

  test('105 ESpellOnCooldown — same copy as dungeon_cast/118', () => {
    expect(humanize_abort(grpc_abort('cast', 105))).toBe(i18n.t('errors.spell_cooldown'))
  })

  test('106 ECastsPerTarget — already hit this target casts_per_target times this turn (NEW)', () => {
    const out = humanize_abort(grpc_abort('cast', 106))
    expect(out).toBe(i18n.t('errors.cast_per_target_limit'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('the PRE-FLIGHT simulation string form ("abort code 105 in cast::act_cast") also resolves', () => {
    const out = humanize_tx_error('SimulationError: MoveAbort abort code 105 in cast::act_cast')
    expect(out).toBe(i18n.t('errors.spell_cooldown'))
  })
})

// S-57 SETTLE→OPEN — the composed one-tx settlement door (`aresrpg_fight::settlement::settle_and_take`). Module
// "settlement"; only the two possession asserts (102/103) are surfaced (both defensive/stale-client).
describe('humanize_abort — composed settlement door (settle_and_take, 102/103)', () => {
  test('102 ENoSuchSeat — this character has no seat in that fight (stale client)', () => {
    const out = humanize_abort(grpc_abort('settlement', 102))
    expect(out).toBe(i18n.t('errors.settle_no_seat'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })
  test('103 ENotSeatOwner — the seat outcome belongs to another wallet', () => {
    expect(humanize_abort(grpc_abort('settlement', 103))).toBe(i18n.t('errors.settle_not_seat_owner'))
  })
  test('101 ENotTerminal (unreachable through the client — settlement runs only on a terminal read) → generic', () => {
    expect(humanize_abort(grpc_abort('settlement', 101))).toBe(i18n.t('errors.tx_failed'))
  })
})

// PRE-EXEC gas/balance refusal rider: a raw "GraphQLResponseError … insufficient SUI
// balance … to satisfy required budget N" must NOT reach the surface. It's not a MoveAbort and escapes JARGON_RE,
// so a dedicated arm humanizes it (quoting the SUI to free when the budget parses) BEFORE the jargon gate.
describe('humanize_tx_error — pre-exec gas-selection / insufficient-balance (no digest, re-armable)', () => {
  const RAW =
    'GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of 1984878292 to satisfy required budget 12750000'
  test('parseable budget → the amount-quoting copy (12750000 MIST → 0.013 SUI), never the raw blob', () => {
    const out = humanize_tx_error(new Error(RAW))
    expect(out).toBe(i18n.t('errors.gas_insufficient_balance', { amount: '0.013' }))
    expect(out).not.toContain('GraphQLResponseError')
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })
  test('same class as a bare string, and via a GraphQL errors[] array', () => {
    expect(humanize_tx_error(RAW)).toBe(i18n.t('errors.gas_insufficient_balance', { amount: '0.013' }))
    expect(humanize_tx_error({ errors: [{ message: RAW }] })).toBe(
      i18n.t('errors.gas_insufficient_balance', { amount: '0.013' })
    )
  })
  test('gas-selection class with NO parseable budget → the generic gas-balance line (not the raw text)', () => {
    const out = humanize_tx_error(new Error('Unable to perform gas selection due to insufficient SUI balance'))
    expect(out).toBe(i18n.t('errors.insufficient_balance'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })
})

// SUBMISSION-TIME LOCK / EQUIVOCATION RACE + sponsor GAS-COIN CONTENTION (2026-07-14 equivocation fix): two
// concurrent sponsorships that pick overlapping gas coins produce a version-lock race — the loser NEVER certifies
// (no digest, no gas burned), yet the old decoder mislabeled it "failed on-chain". The sponsor's reservation now
// refuses the loser PRE-SIGN with 'sponsor-busy'; a residual client-submit lock-race still needs honest RETRYABLE
// copy. CRITICAL (tx-retry-burn law): an EXECUTED abort (digest exists, gas burned) is a MoveAbort handled ABOVE
// via parse_move_abort — it must NEVER reach this arm and be told "nothing charged, retry".
describe('humanize_tx_error — lock-race / equivocation / sponsor-busy (no digest, nothing charged, RETRYABLE)', () => {
  test("the sponsor's own 'sponsor-busy' pre-sign refusal → the retryable copy, never the on-chain-failed line", () => {
    const out = humanize_tx_error(new Error('Sponsor request failed (400): sponsor-busy: gas coins contended, please retry'))
    expect(out).toBe(i18n.t('errors.tx_lock_race_retry'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('a Sui object-version lock conflict at submission → retryable (loser never certifies: no digest, no gas)', () => {
    const out = humanize_tx_error(
      new Error('Transaction locked by another transaction; ObjectVersionUnavailableForConsumption for 0xabc123def456')
    )
    expect(out).toBe(i18n.t('errors.tx_lock_race_retry'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('the "not available for consumption" phrasing (equivocation) resolves — fired BEFORE the jargon gate (0x… id)', () => {
    // the object id (0x…) would trip JARGON_RE into the generic on-chain-failed line if the arm sat after it.
    const out = humanize_tx_error('Object 0xdeadbeefcafe is not available for consumption, its current version is 42')
    expect(out).toBe(i18n.t('errors.tx_lock_race_retry'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('the same class survives via a GraphQL errors[] array and the "reserved for another transaction" phrasing', () => {
    expect(humanize_tx_error({ errors: [{ message: 'quorum of validators locked these objects' }] })).toBe(
      i18n.t('errors.tx_lock_race_retry')
    )
    expect(humanize_tx_error('gas object reserved for another transaction')).toBe(i18n.t('errors.tx_lock_race_retry'))
  })

  // THE TX-RETRY-BURN GUARD: an EXECUTED failure (a real MoveAbort, gas WAS burned) must keep the on-chain-failed
  // copy — the lock-race arm can NEVER steal it (parse_move_abort handles it first and returns).
  test('an EXECUTED MoveAbort is NEVER mislabeled retryable — it keeps errors.tx_failed (gas was burned)', () => {
    expect(humanize_tx_error(grpc_abort('actions', 999))).toBe(i18n.t('errors.tx_failed'))
    expect(humanize_tx_error(grpc_abort('actions', 999))).not.toBe(i18n.t('errors.tx_lock_race_retry'))
  })

  test('a MAPPED executed abort still returns its own specific copy (the arm never intercepts a real abort)', () => {
    expect(humanize_tx_error(grpc_abort('creation', 101))).toBe(i18n.t('errors.name_taken'))
  })
})

// F5 (P2): gathering refusals via the [G] prompt (gather_actions.js → gathering::gather) — was a generic
// "try again" for every code (no `gathering` arm); now player-actionable per refusal reason.
describe('humanize_abort — gathering refusals (F5)', () => {
  test('104/105 EEquipmentUnavailable/ENoTool ("same family") — the named P2: tool guidance instead of generic retry', () => {
    const out = humanize_abort(grpc_abort('gathering', 105))
    expect(out).toBe(i18n.t('errors.gather_no_tool'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
    expect(humanize_abort(grpc_abort('gathering', 104))).toBe(i18n.t('errors.gather_no_tool'))
  })

  test('106 ETierLocked — job level too low for the resource', () => {
    expect(humanize_abort(grpc_abort('gathering', 106))).toBe(i18n.t('errors.gather_tier_locked'))
  })

  test('101/102 ENotInWorld/ENoCheckpoint share the "rejoin the world" copy', () => {
    expect(humanize_abort(grpc_abort('gathering', 101))).toBe(i18n.t('errors.gather_not_in_world'))
    expect(humanize_abort(grpc_abort('gathering', 102))).toBe(i18n.t('errors.gather_not_in_world'))
  })

  test('103/107 ETemplateMismatch/ERareTemplateMismatch share the "stale node, refresh" copy', () => {
    expect(humanize_abort(grpc_abort('gathering', 103))).toBe(i18n.t('errors.gather_stale_node'))
    expect(humanize_abort(grpc_abort('gathering', 107))).toBe(i18n.t('errors.gather_stale_node'))
  })
})

// Dungeon run flow (rider): activate / next_fight / join_fight / settle_run aborts — split across TWO
// MoveLocation modules: `dungeon` (the composition doors) and `run` (the RunPass latch/settle core it calls).
describe('humanize_abort — dungeon run flow (dungeon + run modules)', () => {
  test("dungeon 104 EWrongKey — the flagged family: the burned item is not this world's key", () => {
    const out = humanize_abort(grpc_abort('dungeon', 104))
    expect(out).toBe(i18n.t('errors.dungeon_wrong_key'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('dungeon 103 ENoDungeon — this world has no dungeon', () => {
    expect(humanize_abort(grpc_abort('dungeon', 103))).toBe(i18n.t('errors.dungeon_none'))
  })

  test('dungeon 101/102 ENotInWorld/ENoCheckpoint share the "rejoin the world" copy (the gathering pattern)', () => {
    expect(humanize_abort(grpc_abort('dungeon', 101))).toBe(i18n.t('errors.dungeon_not_in_world'))
    expect(humanize_abort(grpc_abort('dungeon', 102))).toBe(i18n.t('errors.dungeon_not_in_world'))
  })

  test('dungeon 107/110 EWrongTemplate/EWrongWorld share the "run out of sync, refresh" copy', () => {
    expect(humanize_abort(grpc_abort('dungeon', 107))).toBe(i18n.t('errors.dungeon_stale_run'))
    expect(humanize_abort(grpc_abort('dungeon', 110))).toBe(i18n.t('errors.dungeon_stale_run'))
  })

  test('dungeon 109 EWrongRoom — a party member joining from a different room (§9 same-room proof)', () => {
    expect(humanize_abort(grpc_abort('dungeon', 109))).toBe(i18n.t('errors.dungeon_wrong_room'))
  })

  test('run 104 EAlreadyLatched — double-ENGAGE while the pass is latched to a live room fight', () => {
    expect(humanize_abort(grpc_abort('run', 104))).toBe(i18n.t('errors.dungeon_fight_live'))
  })

  test('run 105 ENotInFight — double-settle (two tabs / refresh mid-chain): nothing left to settle', () => {
    expect(humanize_abort(grpc_abort('run', 105))).toBe(i18n.t('errors.dungeon_already_settled'))
  })

  test('unassigned/unreachable codes degrade generic: dungeon 111, run 102 ENotOwner', () => {
    expect(humanize_abort(grpc_abort('dungeon', 111))).toBe(i18n.t('errors.tx_failed'))
    expect(humanize_abort(grpc_abort('run', 102))).toBe(i18n.t('errors.tx_failed'))
  })
})

// S-84 — the create-modal funnel (`aresrpg::creation`). An un-whitelisted class reads
// "This class is coming soon"; the other player-reachable codes (name taken / invalid / paused / can't afford /
// free already claimed) get honest copy too. The bootstrap free-path gates 109/110/111 stay generic.
describe('humanize_abort — creation gate (S-84 create funnel)', () => {
  test('103 EUnknownClass → "This class is coming soon", never a raw abort', () => {
    const out = humanize_abort(grpc_abort('creation', 103))
    expect(out).toBe(i18n.t('errors.class_coming_soon'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('101/102/104/105 name-taken / name-invalid / paused / insufficient-payment map to honest copy', () => {
    expect(humanize_abort(grpc_abort('creation', 101))).toBe(i18n.t('errors.name_taken'))
    expect(humanize_abort(grpc_abort('creation', 102))).toBe(i18n.t('errors.name_invalid'))
    expect(humanize_abort(grpc_abort('creation', 104))).toBe(i18n.t('errors.creation_paused'))
    expect(humanize_abort(grpc_abort('creation', 105))).toBe(i18n.t('errors.creation_insufficient_payment'))
  })

  test('106 EFreeCharacterClaimed reuses the character-arm free-claimed copy (one home)', () => {
    expect(humanize_abort(grpc_abort('creation', 106))).toBe(i18n.t('errors.free_already_claimed'))
  })

  test('bootstrap free-path gates stay generic: 109 ENotZkLoginAddress / 110 ENotAppSponsored / 111 EFreeDisabled', () => {
    expect(humanize_abort(grpc_abort('creation', 109))).toBe(i18n.t('errors.tx_failed'))
    expect(humanize_abort(grpc_abort('creation', 110))).toBe(i18n.t('errors.tx_failed'))
    expect(humanize_abort(grpc_abort('creation', 111))).toBe(i18n.t('errors.tx_failed'))
  })
})

// KOLIZEUM LEVEL HONESTY — the War Table's create/join/exit/cancel doors
// (kolizeum_actions.js, the only kolizeum.move doors this frontend calls). ELevelTooLow (103) can't
// carry the gate NUMBER (a Move abort is a bare code) — the create/join PRE-CHECK (kolizeum.tsx) shows
// the actual number inline BEFORE the tx fires; this arm is the honest fallback for the residual race.
describe('humanize_abort — kolizeum lobby doors (KOLIZEUM LEVEL HONESTY)', () => {
  test('103 ELevelTooLow — create/join: character level below the kolizeum gate (the headline fix)', () => {
    const out = humanize_abort(grpc_abort('kolizeum', 103))
    expect(out).toBe(i18n.t('errors.kolizeum_level_too_low'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('101 EBadFormat — create: format not in {1,3,6}, or above a tightened team-size-bound dial', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 101))).toBe(i18n.t('errors.kolizeum_bad_format'))
  })

  test('102 EPledgeMismatch — create/join: the built pledge coin does not match the lobby stake', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 102))).toBe(i18n.t('errors.kolizeum_pledge_mismatch'))
  })

  test("104 ELevelDiffTooHigh — join: level too far from the creator's for this lobby's max-diff dial", () => {
    expect(humanize_abort(grpc_abort('kolizeum', 104))).toBe(i18n.t('errors.kolizeum_level_diff'))
  })

  test('105 ENotOpen — join/exit/cancel: the lobby left OPEN in the race between poll and click', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 105))).toBe(i18n.t('errors.kolizeum_not_open'))
  })

  test("106 ENotFriend — join: a friends-only lobby and the joiner is not in the creator's snapshot", () => {
    expect(humanize_abort(grpc_abort('kolizeum', 106))).toBe(i18n.t('errors.kolizeum_not_friend'))
  })

  test('107 EAlreadyJoined — join: this wallet or character already holds a seat here', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 107))).toBe(i18n.t('errors.kolizeum_already_joined'))
  })

  test('108 ESideFull — join: the auto-balanced side filled between poll and click', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 108))).toBe(i18n.t('errors.kolizeum_side_full'))
  })

  test('110 ENotParticipant — exit: the exit button has no membership guard, so a non-member can click it', () => {
    expect(humanize_abort(grpc_abort('kolizeum', 110))).toBe(i18n.t('errors.kolizeum_not_participant'))
  })

  test('unreachable-through-this-frontend codes degrade generic: 109 (create_friends_only unused), 111 (cancel is client-gated), 112-116 (start/seat/settle/sweep not wired here)', () => {
    for (const code of [109, 111, 112, 113, 114, 115, 116]) {
      expect(humanize_abort(grpc_abort('kolizeum', code))).toBe(i18n.t('errors.tx_failed'))
    }
  })
})

// D54b — the anti-teleport travel-verification leaf (checkpoint.move), shared by zones::search_zone AND
// gathering::gather (the abort surfaces under ITS OWN module "checkpoint", never the caller — same pattern
// as the `settlement`/`run` leaf arms above). No client wiring can compute an approximate wait (no SDK export
// of wait_seconds, and a Move abort carries zero payload) so both codes stay honest generic-teach lines.
describe('humanize_abort — checkpoint travel-verification gate (D54b, zones + gathering share this leaf)', () => {
  test('102 ETravelTooFar — moved farther than the elapsed time supports (a "search then fails" report)', () => {
    const out = humanize_abort(grpc_abort('checkpoint', 102))
    expect(out).toBe(i18n.t('errors.travel_too_far'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })

  test('101 ECheckpointFuture — clock landed before the last checkpoint (transient desync)', () => {
    const out = humanize_abort(grpc_abort('checkpoint', 101))
    expect(out).toBe(i18n.t('errors.checkpoint_clock_desync'))
    expect(out).not.toBe(i18n.t('errors.tx_failed'))
  })
})

describe('tx_error — humanized message + structured abort preserved on .cause', () => {
  test('an Error carrying the structured abort on .cause: message is copy, .cause parses to module+code', () => {
    const raw = grpc_abort('dungeon_claim', 110)
    const err = tx_error(raw)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toBe('[object Object]')
    expect(err.cause).toBe(raw)
    // parse_move_abort must reach the abort THROUGH the .cause chain (claim_race classification relies on this)
    expect(parse_move_abort(err)).toEqual({ module: 'dungeon_claim', code: 110, package: '0x2476' })
  })

  test('re-humanizing a tx_error is idempotent (copy in, copy out)', () => {
    const err = tx_error(grpc_abort('spell_book', 204))
    expect(humanize_tx_error(err)).toBe(i18n.t('errors.spell_maxed'))
  })
})

// TOAST-OVERRIDE SWEEP (07-10) — the other end of the humanization pipeline: abort_copy only matters if what
// it produces actually reaches the player. use_toast.promise()'s `messages.error ?? rejection.message` fallback
// silently prefers a STATIC `error:` string when one is passed — the exact bug an audit found across 8+ call
// sites (marketplace_chain.ts ×7, dungeon/party actions, friends/scribe/shop/vault/pet/world-switcher flows): a
// fixed banner string always won over the real rejection, so abort_copy's humanized `.message` never reached the
// player. This pins the fix contract those sites now rely on: omit `error`, and the rejection's own `.message`
// survives verbatim through the toast.
describe('use_toast.promise — a rejection message survives when no static `error:` override is passed', () => {
  test('the real .message becomes the error toast, untouched, when messages.error is omitted', async () => {
    const humanized = 'That character is busy and cannot use items right now'
    await expect(
      use_toast.getState().promise(Promise.reject(new Error(humanized)), { pending: 'Doing thing…' })
    ).rejects.toThrow(humanized)
    const error_toast = [...use_toast.getState().toasts].reverse().find((t) => t.type === 'error')
    expect(error_toast?.message).toBe(humanized)
  })
})

// Production gap closed 2026-07-10: an abort-111 refusal (fight::ECharacterMarked — an unopened result blocks the seat) IS
// a detection signal — tx_error kicks the registered marker-refusal hook (dungeon_store's tail wires it to the
// shared auto-open entry). The kick is a guarded microtask: the throw path itself never changes shape.
describe('tx_error — the abort-111 marker-refusal hook (detection must not depend on a UI surface)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  test('a fight.111 abort kicks the registered handler exactly once (microtask)', async () => {
    let kicks = 0
    on_marker_refusal(() => {
      kicks += 1
    })
    const err = tx_error(grpc_abort('fight', 111))
    expect(err.message).toBe(i18n.t('errors.fight_unclaimed_result')) // the humanized copy still throws
    expect(kicks).toBe(0) // never synchronous — the throw path is untouched
    await flush()
    expect(kicks).toBe(1)
    on_marker_refusal(null)
  })

  test('other aborts / non-aborts never kick, and a throwing handler never breaks the throw path', async () => {
    let kicks = 0
    on_marker_refusal(() => {
      kicks += 1
      throw new Error('handler boom')
    })
    tx_error(grpc_abort('fight', 101)) // different code
    tx_error(grpc_abort('fight_registry', 103)) // different module
    tx_error('a plain human message')
    tx_error(null)
    await flush()
    expect(kicks).toBe(0)
    const err = tx_error(grpc_abort('fight', 111)) // constructs + kicks; the handler boom stays contained
    expect(err.message).toBe(i18n.t('errors.fight_unclaimed_result'))
    await flush()
    expect(kicks).toBe(1)
    on_marker_refusal(null)
  })
})

// S-84 — the maintenance-pause reactive net: a version/102 abort (any package — core/engine/spells/social all
// share the SAME module name + code) must kick the registered handler exactly like the marker-refusal hook,
// while NEVER kicking on the unrelated EWrongVersion (101, a real stale-client bug, not a pause signal).
describe('tx_error — the version/102 maintenance-pause hook (contracts_paused_modal.tsx registers it)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  test('a version.102 abort (any package) kicks the registered handler exactly once (microtask)', async () => {
    let kicks = 0
    on_maintenance_abort(() => {
      kicks += 1
    })
    const err = tx_error(grpc_abort('version', 102))
    expect(kicks).toBe(0) // never synchronous — the throw path is untouched
    await flush()
    expect(kicks).toBe(1)
    // a DIFFERENT package's version/102 still kicks — the hook is package-agnostic by design.
    tx_error({
      ...grpc_abort('version', 102),
      MoveAbort: { abortCode: '102', location: { module: 'version', package: '0xfeed' } },
    })
    await flush()
    expect(kicks).toBe(2)
    expect(err.message).not.toContain('MoveAbort') // still humanized copy, never raw jargon
    on_maintenance_abort(null)
  })

  test('EWrongVersion (101, a stale-client bug) never kicks the maintenance hook, and a throwing handler never breaks the throw path', async () => {
    let kicks = 0
    on_maintenance_abort(() => {
      kicks += 1
      throw new Error('handler boom')
    })
    tx_error(grpc_abort('version', 101)) // EWrongVersion — a real bug class, not a pause signal
    tx_error(grpc_abort('fight', 111)) // different module entirely
    await flush()
    expect(kicks).toBe(0)
    tx_error(grpc_abort('version', 102)) // constructs + kicks; the handler boom stays contained
    await flush()
    expect(kicks).toBe(1)
    on_maintenance_abort(null)
  })
})

// ── ITEM 1 — the PRE-FLIGHT simulation abort form + the toast-honesty split ──────────────
// The deadline auto-commit fired begin_action into a fight the killing blow already ENDED. The node's dry-run
// refusal reports the abort as "SimulationError: MoveAbort abort code 101 in actions::begin_action" (NOT the
// executed Identifier(...) shape), so (a) is_fight_over_abort could never swallow the terminal-race 101, and
// (b) the toast lied "failed on-chain — nothing changed" for a tx that was NEVER sent (zero gas).
const sim_err = (msg) => {
  const e = new Error(msg)
  e.name = 'SimulationError'
  return e
}

describe('parse_move_abort — the PRE-FLIGHT simulation string form (the terminal-race swallow depends on it)', () => {
  test('"abort code 101 in actions::begin_action" → { module: actions, code: 101 } (is_fight_over_abort keys on this)', () => {
    expect(parse_move_abort(sim_err('MoveAbort abort code 101 in actions::begin_action'))).toEqual({
      module: 'actions',
      code: 101,
    })
  })

  test('the sim form carried on .cause (the tx_error wrap) still parses through', () => {
    const wrapped = new Error('some already-humanized player copy')
    // @ts-ignore
    wrapped.cause = sim_err('MoveAbort abort code 101 in actions::begin_action')
    expect(parse_move_abort(wrapped)).toEqual({ module: 'actions', code: 101 })
  })

  test('a PACKAGE-qualified "in 0xabc::actions::act_move" resolves the MODULE (not the package)', () => {
    expect(parse_move_abort('abort code 104 in 0xabc123::actions::act_move')).toEqual({ module: 'actions', code: 104 })
  })

  // The @mysten/sui 2.20.1 `formatMoveAbortMessage` shape a self-pay wallet surfaces on an EXECUTED abort — the
  // EXACT string the mid-fight-refresh 104 reached the toast as: colon after `code`, comma, and a quoted
  // `pkg::module::fn`. The plain-space SIM_ABORT_RE (`abort code N in mod::fn`) missed all three, so it fell raw.
  test('the @mysten/sui 2.20.1 executed-string form ("abort code: 104, in \'0x…::actions::act_move\'") parses', () => {
    expect(
      parse_move_abort(
        "MoveAbort in 1st command, abort code: 104, in '0x0000000000000000000000000000000000000000000000000000000000000000::actions::act_move' (instruction 18)"
      )
    ).toEqual({ module: 'actions', code: 104 })
  })

  test('that 2.20.1 executed-string 104 humanizes to the stale-board copy, never raw jargon', () => {
    const out = humanize_tx_error(
      "MoveAbort in 1st command, abort code: 104, in '0x0::actions::act_move' (instruction 18)"
    )
    expect(out).toBe(i18n.t('errors.fight_stale_board'))
    expect(out).not.toContain('MoveAbort')
  })

  test('the executed Identifier(...) form is UNAFFECTED (still parses via the legacy path)', () => {
    expect(parse_move_abort('MoveAbort(MoveLocation { module: Identifier("actions") }, 101) in command 0')).toEqual({
      module: 'actions',
      code: 101,
    })
  })
})

describe('is_preflight_refusal + humanize honesty split (never "failed on-chain" for a tx that never sent)', () => {
  test('a SimulationError is a pre-flight refusal (zero gas)', () => {
    expect(is_preflight_refusal(sim_err('MoveAbort abort code 999 in actions::foo'))).toBe(true)
  })

  test('an EXECUTED gRPC MoveAbort is NOT a pre-flight refusal (gas WAS burned — never mislabel it "no gas")', () => {
    expect(is_preflight_refusal(grpc_abort('actions', 999))).toBe(false)
  })

  test('humanize_tx_error: a pre-flight refusal → the honest "refused, no gas" copy, NOT the on-chain-failed copy', () => {
    // 2026-07-19 "must say why": an UNMAPPED abort no longer stands generic-alone — the honest headline still
    // leads (this test's core safety property), now with a second "Reason:" line naming module+code so a
    // zero-gas refusal is never pure silence. See the sibling describe block below for the reason-line coverage.
    const copy = humanize_tx_error(sim_err('MoveAbort abort code 999 in actions::foo'))
    expect(copy).toContain(i18n.t('errors.tx_refused_preflight'))
    expect(copy).not.toContain(i18n.t('errors.tx_failed'))
  })

  test('humanize_tx_error: an EXECUTED unmapped abort KEEPS the on-chain-failed copy (a digest exists = gas spent)', () => {
    expect(humanize_tx_error(grpc_abort('actions', 999))).toBe(i18n.t('errors.tx_failed'))
  })

  test('a MAPPED abort still returns its specific copy regardless of pre-flight vs executed (the split only touches the generic fallback)', () => {
    expect(humanize_tx_error(sim_err('MoveAbort abort code 105 in actions::abandon'))).toBe(
      i18n.t('errors.abandon_fight_over')
    )
  })
})

// ISSUE #15 — "stale-version equipment": the humanized copy for equipment::ETemplateMismatch/item::EPledgeMismatch
// already existed (TABLE below), but NOTHING classified it as the refresh-fixable local-read-staleness family —
// lootbox-retry-guard.js's block_equip_retry only latches a digest-proven (gas-burned) failure, so this exact
// zero-gas refusal reached a dead end (proven by lootbox-retry-guard.test.js's pre-existing
// "pre-flight refusals without a digest never arm the equip latch" case). is_equip_state_refusal is the new
// structural classifier the retry-guard's block_equip_state_refresh consumes to arm the SAME refresh affordance
// honestly (never claims "gas may have spent" for a tx that never signed).
describe('is_equip_state_refusal (issue #15 — refresh-fixable equip/unequip local-read staleness)', () => {
  test('recognizes every mapped template/state-mismatch code in the family', () => {
    expect(is_equip_state_refusal(grpc_abort('equipment', 110))).toBe(true) // ETemplateMismatch
    expect(is_equip_state_refusal(grpc_abort('item', 101))).toBe(true) // EPledgeMismatch
    expect(is_equip_state_refusal(grpc_abort('item', 106))).toBe(true) // ETemplateMismatch
    expect(is_equip_state_refusal(grpc_abort('extract', 101))).toBe(true) // EPledgeMismatch
  })

  test('does not fire for an unrelated mapped abort, a non-abort error, or nullish input', () => {
    expect(is_equip_state_refusal(grpc_abort('equipment', 109))).toBe(false) // ELevelTooLow — different family
    expect(is_equip_state_refusal(new Error('network blip'))).toBe(false)
    expect(is_equip_state_refusal(null)).toBe(false)
  })

  test('recognizes the legacy MoveAbort string shape too (both receipt forms, like every TABLE entry)', () => {
    const legacy = 'MoveAbort(MoveLocation { module: ModuleId { name: Identifier("equipment") } }, 110) ...'
    expect(is_equip_state_refusal(legacy)).toBe(true)
  })
})

// ISSUE #88 — item_stats/101 (EInvalidScale) is reachable in production ONLY through a pet-equip's power
// normalization (equipment.move:160 calls item_stats::pet_stats_at_count off the stored, possibly LEGACY,
// PetPowerKey; the roll-time caller can never trip it — numerator 0 always <= any denominator). It is
// therefore NEVER a transient stale-read race: a legacy-fed pet's power stays past the 60-feed bound until
// the chain-side migration ships, so the copy must not invite a "refresh and retry" that can only fail again.
describe('humanize_abort — item_stats/101 pet-equip legacy-power scale (issue #88, PERMANENT — never "refresh and retry")', () => {
  test('maps to the honest pet-specific copy, both receipt shapes', () => {
    expect(humanize_abort(grpc_abort('item_stats', 101))).toBe(i18n.t('errors.item_scale_failed'))
    const legacy = 'MoveAbort(MoveLocation { module: ModuleId { name: Identifier("item_stats") } }, 101) ...'
    expect(humanize_abort(legacy)).toBe(i18n.t('errors.item_scale_failed'))
  })

  test('the copy never tells the player to retry — that would be a lie for a legacy-encoded pet', () => {
    const copy = i18n.t('errors.item_scale_failed')
    expect(copy.toLowerCase()).not.toMatch(/refresh|retry|try again/)
  })
})

// ISSUE #22 sweep finding — world_join.js's sponsored_join() threw `new Error(res.effects.status.error)` where
// `.error` is the STRUCTURED gRPC/station abort object (the exact shape grpc_abort() mirrors below): the Error
// constructor coerces a non-string message via ToString → the literal "[object Object]" — and to_message_string's
// own guard then REFUSES that exact literal, so the mapped abort silently degraded to the generic fallback
// instead of its specific copy. This proves the mechanical bug the fix (world_join.js now throws
// `tx_error(res.effects.status.error, { preflight })`) closes — a decoder-level proof, since world_join.js's
// sponsored path has no existing test seam (auth/execute_sponsored_tx needs a live wallet-standard mock).
describe('issue #22 — a bare `new Error(structuredAbort)` silently degrades a MAPPED code (world_join.js class)', () => {
  const structured_abort = grpc_abort('version', 101) // EWrongVersion — a real code a join could hit

  test('RED (the old pattern): new Error(structuredAbort) loses the mapping to the generic line', () => {
    const old_pattern_error = new Error(structured_abort)
    expect(old_pattern_error.message).toBe('[object Object]')
    expect(humanize_tx_error(old_pattern_error)).toBe(i18n.t('errors.tx_failed'))
    expect(humanize_tx_error(old_pattern_error)).not.toBe(i18n.t('errors.world_version_changed'))
  })

  test('GREEN (the fix): tx_error(structuredAbort, { preflight }) keeps the specific mapped copy', () => {
    const fixed = tx_error(structured_abort, { preflight: true })
    expect(fixed.message).toBe(i18n.t('errors.world_version_changed'))
    expect(is_preflight_refusal(fixed)).toBe(true) // the honesty split survives the wrap (zero gas, retryable)
  })
})

// ── 07-18 VICTORY-CARD STARVATION (driven-composite ground truth, trace 121623ms): the SELF-PAY gas-guard's
// dry-run refusal (tx/index.ts guard() — simulate said the settle WOULD abort settlement::101 ENotTerminal
// because the fullnode's dry-run lagged the killing commit by ~340ms; it REFUSED pre-sign, ZERO gas, NO digest)
// threw `tx_error(chain_error)` with NO pre-flight provenance. The structured gRPC blob is byte-identical to an
// EXECUTED abort, so the refusal classified EXECUTED → the burn-law latch armed → the core's terminal-race
// retry engine (liveness re-read → settlement_snapshot confirmation → fresh request) was never allowed to run →
// no receipt ever existed → the fight_result slice stayed 'pending' → the victory card's .fe-gain skeletoned
// forever (93 empty polls over 45s). The fix: the thrower KNOWS nothing was signed — tx_error(raw,
// { preflight: true }) stamps the established `SimulationError` house marker BEFORE baking the message, so the
// copy honesty split AND the burn-law classifier (error_preflight_marked) both see it.
describe('tx_error preflight provenance — the gas-guard dry-run refusal keeps its zero-gas identity (07-18)', () => {
  // the EXACT trace shape: simulateTransaction effects.status.error for the terminal-race settle refusal
  const settle_race = () => grpc_abort('settlement', 101)

  test('RED 07-18: tx_error(blob, { preflight: true }) IS a pre-flight refusal (the marker survives the wrap)', () => {
    expect(is_preflight_refusal(tx_error(settle_race(), { preflight: true }))).toBe(true)
  })

  test('the marked refusal carries the HONEST copy (refused pre-send, no gas) — never the executed "gas spent" line', () => {
    // settlement/101 is unmapped, so this now carries the "must say why" reason line (2026-07-19) — the headline
    // itself (this test's actual point) is untouched: still the honest zero-gas copy, never the executed one.
    const err = tx_error(settle_race(), { preflight: true })
    expect(err.message).toContain(i18n.t('errors.tx_refused_preflight'))
    expect(err.message).not.toContain(i18n.t('errors.tx_failed'))
  })

  test('an UNMARKED tx_error over the same blob stays executed-classified (burn-law conservatism intact)', () => {
    const err = tx_error(settle_race())
    expect(is_preflight_refusal(err)).toBe(false)
    expect(err.message).toBe(i18n.t('errors.tx_failed'))
  })

  test('marking never breaks numeric classification — parse_move_abort still digs the abort off .cause', () => {
    expect(parse_move_abort(tx_error(settle_race(), { preflight: true }))).toEqual({
      module: 'settlement',
      code: 101,
      package: '0x2476',
    })
  })

  test('a MAPPED abort keeps its specific copy under the marker (the split only ever touched the generic fallback)', () => {
    // actions::105 is TABLE-mapped — provenance must not demote mapped copy to the generic preflight line.
    expect(tx_error(grpc_abort('actions', 105), { preflight: true }).message).toBe(i18n.t('errors.abandon_fight_over'))
  })
})

// PRE-FLIGHT "MUST SAY WHY" — the 3rd generic refusal that night, zero indication of the
// actual reason): a zero-gas refusal with NOTHING mapped used to be pure silence — "refused, no gas, try again"
// and nothing else, even when a MORE SPECIFIC cause WAS decodable (the abort's own module+code; a non-MoveAbort
// gRPC ExecutionError's structural $kind). RED before this fix: every case below returned the flat generic
// headline alone (see the three updated assertions above this block — they used to `toBe` that exact string).
describe('PRE-FLIGHT "must say why" — a decodable cause rides as a second "Reason:" line (never invented)', () => {
  test('unmapped abort + preflight → headline AND a Reason line naming module + code', () => {
    const out = humanize_tx_error(sim_err('MoveAbort abort code 999 in actions::foo'))
    expect(out).toBe(i18n.t('errors.tx_refusal_reason', { headline: i18n.t('errors.tx_refused_preflight'), reason: i18n.t('errors.tx_refusal_reason_unmapped', { module: 'actions', code: 999 }) }))
  })

  test('unmapped abort + EXECUTED (no preflight marker) → UNCHANGED single generic, no invented reason', () => {
    expect(humanize_tx_error(grpc_abort('actions', 999))).toBe(i18n.t('errors.tx_failed'))
  })

  test('a MAPPED abort under preflight still stands ALONE — the reason line never pads a known-good copy', () => {
    expect(tx_error(grpc_abort('party', 205), { preflight: true }).message).toBe(i18n.t('errors.party_invite_not_found'))
  })

  test('non-MoveAbort structural gRPC failure (CommandArgumentError, empty server description) → classified, not silent', () => {
    // mirrors parseGrpcExecutionError's real output shape (@mysten/sui/dist/grpc/core.mjs): every non-abort kind
    // carries $kind + a `message` sourced from the node's OPTIONAL `description` — empty here (the worst case:
    // to_message_string would otherwise return '' and the whole cause vanishes into the flat generic).
    const chain_error = { $kind: 'CommandArgumentError', message: '', command: 0, CommandArgumentError: { argument: 2, name: 'TYPE_MISMATCH' } }
    const out = humanize_tx_error({ name: 'SimulationError', cause: chain_error })
    expect(out).toBe(i18n.t('errors.tx_refusal_reason', { headline: i18n.t('errors.tx_refused_preflight'), reason: i18n.t('errors.tx_stale_reference') }))
  })

  test('non-MoveAbort structural gRPC failure with the "Unknown error" server fallback → STILL our own classified copy, never the raw server string', () => {
    // parseGrpcExecutionError's literal fallback when `description` is absent — an untranslated, unhelpful
    // pass-through would otherwise win the jargon gate (it contains none of JARGON_RE's chain-syntax markers).
    const chain_error = { $kind: 'TypeArgumentError', message: 'Unknown error', command: 0, TypeArgumentError: { typeArgument: 0, name: 'TYPE_NOT_FOUND' } }
    const out = humanize_tx_error({ name: 'SimulationError', cause: chain_error })
    expect(out).not.toContain('Unknown error')
    expect(out).toContain(i18n.t('errors.tx_stale_reference'))
  })

  test('CongestedObjects structural kind reuses the existing lock-race copy (same "retry, nothing charged" shape)', () => {
    const chain_error = { $kind: 'CongestedObjects', message: '', command: 0, CongestedObjects: { objects: ['0xdeadbeef'] } }
    const out = humanize_tx_error({ name: 'SimulationError', cause: chain_error })
    expect(out).toContain(i18n.t('errors.tx_lock_race_retry'))
  })
})

// BACKLOG 18 — the character DELETE door arm (`aresrpg::character_extract::delete_character`). Each on-chain
// guard refusal maps to honest, actionable copy; the framework kiosk walls (wrong kiosk/cap) already ride the
// `kiosk` arm. Self-consistent against i18n.t so the vectors hold before AND after the locale keys land.
describe('character_extract arm — delete-door refusals map to honest copy', () => {
  test('101 EItemsEquipped / 102 EUnfinishedBusiness / 103 EInDungeon', () => {
    expect(humanize_tx_error(grpc_abort('character_extract', 101))).toBe(i18n.t('errors.delete_items_equipped'))
    expect(humanize_tx_error(grpc_abort('character_extract', 102))).toBe(i18n.t('errors.delete_unfinished_fight'))
    expect(humanize_tx_error(grpc_abort('character_extract', 103))).toBe(i18n.t('errors.delete_in_dungeon'))
  })

  test('the SIMULATION string form maps too (pre-flight dry-run refusal)', () => {
    const out = humanize_tx_error('SimulationError: MoveAbort abort code 101 in character_extract::delete_character')
    expect(out).toBe(i18n.t('errors.delete_items_equipped'))
  })

  test('the legacy "first character can\'t be deleted" row is GONE (BACKLOG 18 made every character deletable)', () => {
    // character/111 no longer exists in the live module NOR the table — it must fall through to the generic
    // line, never the contradicting "Your first character can't be deleted." copy.
    expect(humanize_tx_error(grpc_abort('character', 111))).not.toBe(i18n.t('errors.first_char_undeletable'))
  })
})
