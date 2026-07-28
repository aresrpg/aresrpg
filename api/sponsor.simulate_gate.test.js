// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SIMULATE GATE (#1385, hardened #796) — the sponsor must never sponsor a PTB its own dry-run did not prove
// clean. Before the gate, reserveSponsored read `gasUsed` off `Transaction ?? FailedTransaction`, so an ABORTING
// simulation was treated as a valid price quote: the sponsor reserved, the station co-signed and SUBMITTED, and
// the player got "executed on chain, gas was spent". That also made the pool grief-able — an attacker could
// burn sponsor SUI all day with PTBs that cannot succeed.
//
// #796 closed the second half: the first gate was REFUSE-BY-EXCEPTION (refuse what looks failed, price the
// rest), so a result carrying no success verdict at all — missing status, unknown union tag, non-boolean
// `success` — was priced as clean. The gate is now ALLOW-BY-EXCEPTION, and "would abort" and "unreadable" are
// separate machine reasons: the chain saying no is not the same fact as us learning nothing.
//
//   bun test ./sponsor.simulate_gate.test.js    (no Redis, no fullnode, no station — pure decisions only)
//
// Own process on purpose (like every sibling suite): sponsor state reads REDIS_URL at module load.
//
// PROVENANCE (decode law — a codec test that encodes with the model it decodes with proves nothing):
//   · the two failure STRINGS below are CAPTURED from real testnet transactions the missing gate let execute,
//     quoted byte-for-byte from their on-chain effects:
//       DWB7m5GMAZ8XufziYiXciTntozg7TgTxFdWFT1Pg6GNq — 2026-07-27T17:00:57Z, sponsored, MoveAbort turns::crank 107
//       342GRnWK69pqPTUjNJFU8LDQ4Ms1xYfbLdh9XE164Bey — 2026-07-27T21:24:21Z, sponsored, InputObjectDeleted
//   · the ENVELOPE around them is the shape `@mysten/sui`'s own gRPC core hands us — SuiGrpcClient.core
//     .simulateTransaction returns `{ $kind, Transaction|FailedTransaction }` and its parseTransactionEffects
//     normalizes `status` to a STRICT boolean (dist/grpc/core.mjs). There is no offline capture path for a raw
//     envelope (the sponsor image has no node), so the SDK-version tripwire at the bottom of this file is what
//     keeps that borrowed contract honest: bump @mysten/sui and this file demands a re-read.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import sui_package from '@mysten/sui/package.json' with { type: 'json' }

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }
// The client's verdict for the SAME question, imported from the frontend so a future divergence between the two
// homes fails a test instead of shipping (the sponsor image can't import it — see classify_simulation's jsdoc).
import { gas_guard_decision } from '../packages/frontend/src/game/core/gas_guard.js'

process.env.REDIS_URL = ''
process.env.GAS_STATION_URL ||= 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH ||= 'test-bearer'
const S = await import('./sponsor.mjs')

const MOVE_ABORT_CRANK_107 =
  'MoveAbort(MoveLocation { module: ModuleId { address: ' +
  'e8c6c46893799e85e697ef0e524626c6323ea4db5a86da6c9de4a6d53c7ac41a, name: Identifier("turns") }, function: 6, ' +
  'instruction: 36, function_name: Some("crank") }, 107) in command 0'
const INPUT_OBJECT_DELETED = 'InputObjectDeleted'

const gas_used = { computationCost: '1270000', storageCost: '22359200', storageRebate: '22135608' }
const ok_sim = { $kind: 'Transaction', Transaction: { effects: { status: { success: true }, gasUsed: gas_used } } }
const failed_tagged = (error) => ({
  $kind: 'FailedTransaction',
  FailedTransaction: { effects: { status: { success: false, error }, gasUsed: gas_used } },
})
// The same abort WITHOUT the union tag — a transport/version that reports status only. Untagged failures are the
// exact shape that slips a naive `?.Transaction` read, so both homes must catch it.
const failed_untagged = (error) => ({
  $kind: 'Transaction',
  Transaction: { effects: { status: { success: false, error }, gasUsed: gas_used } },
})

describe('classify_simulation — a would-abort simulation is a REFUSAL, never a price quote', () => {
  test('a tagged FailedTransaction returns the chain error verbatim (real captured MoveAbort)', () => {
    expect(S.classify_simulation(failed_tagged(MOVE_ABORT_CRANK_107))).toEqual({
      ok: false,
      reason: S.WOULD_ABORT_REASON,
      chain_error: MOVE_ABORT_CRANK_107,
    })
  })

  test('an untagged status.success === false is refused too (real captured InputObjectDeleted)', () => {
    expect(S.classify_simulation(failed_untagged(INPUT_OBJECT_DELETED)).chain_error).toBe(INPUT_OBJECT_DELETED)
  })

  test('a failure with no error string still refuses (never sponsor an unexplained failure)', () => {
    expect(S.classify_simulation(failed_tagged(undefined)).chain_error).toBe('simulation reported failure')
  })

  test('a passing simulation is accepted and hands back the effects it was priced from', () => {
    const verdict = S.classify_simulation(ok_sim)
    expect(verdict.ok).toBe(true)
    expect(verdict.effects.gasUsed).toBe(gas_used)
  })
})

// ── THE #796 FINDING. Every shape below carries NO success verdict. The old gate priced all of them: it only
// refused what actively LOOKED failed, so "no status", "unknown union tag" and the string "false" read as clean
// and had `gasUsed` taken off them. They are refused now, under their OWN reason — an unreadable simulation is
// a protocol/infrastructure fact, not the chain telling the player their action would fail, and the two must
// never share copy or a counter.
describe('classify_simulation — an UNREADABLE result refuses under its own machine reason', () => {
  const unreadable = {
    'null result': null,
    'undefined result': undefined,
    'empty object': {},
    'no effects at all': { $kind: 'Transaction', Transaction: {} },
    'FailedTransaction tag with no effects': { $kind: 'FailedTransaction', FailedTransaction: {} },
    'effects with NO status': { $kind: 'Transaction', Transaction: { effects: { gasUsed: gas_used } } },
    'status with no success field': {
      $kind: 'Transaction',
      Transaction: { effects: { status: {}, gasUsed: gas_used } },
    },
    'non-boolean success ("false" as a string)': {
      $kind: 'Transaction',
      Transaction: { effects: { status: { success: 'false' }, gasUsed: gas_used } },
    },
    'non-boolean success ("true" as a string)': {
      $kind: 'Transaction',
      Transaction: { effects: { status: { success: 'true' }, gasUsed: gas_used } },
    },
    'unknown union tag carrying a clean-looking Transaction': {
      $kind: 'SomethingElse',
      Transaction: { effects: { status: { success: true }, gasUsed: gas_used } },
    },
    'missing union tag entirely': { Transaction: { effects: { status: { success: true }, gasUsed: gas_used } } },
  }
  for (const [name, sim] of Object.entries(unreadable))
    test(`${name} → refused as ${S.SIMULATION_UNREADABLE_REASON}`, () => {
      const verdict = S.classify_simulation(sim)
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toBe(S.SIMULATION_UNREADABLE_REASON)
      // and NEVER misfiled as the chain's own verdict — that would show the player an abort that never happened
      expect(verdict.reason).not.toBe(S.WOULD_ABORT_REASON)
    })
})

// ── The reason reaches the client on the ERROR ITSELF, never re-derived from its message text. Driven through a
// REAL gate (assert_ptb_scope on a real retired id from the release artifact) into the REAL response encoder —
// no hand-built error carrying an exported prefix, which would only prove the encoder agrees with itself.
describe('a refusal carries its machine reason structurally, into the wire response', () => {
  const scope_refusal = (kind) => {
    try {
      S.assert_ptb_scope(kind)
      return null
    } catch (error) {
      return error
    }
  }

  test('the retired-package gate tags its own error and the response carries the reason', async () => {
    const [retired] = release.networks.testnet.packages.engine.previous ?? []
    expect(retired).toBeTruthy() // the artifact must still carry a retired id, or this proves nothing
    const tx = new Transaction()
    tx.moveCall({ target: `${retired}::actions::act_pass` })
    const refusal = scope_refusal(toBase64(await tx.build({ onlyTransactionKind: true })))
    expect(refusal?.sponsor_reason).toBe(S.OUTDATED_PACKAGE_REASON)
    expect(S.sponsor_error_response(refusal)).toEqual({ error: refusal.message, reason: S.OUTDATED_PACKAGE_REASON })
  })

  test('an untagged refusal from the SAME gate carries NO reason (callers must not branch on it)', async () => {
    const tx = new Transaction()
    tx.moveCall({ target: `0x${'de'.repeat(32)}::bomb::inflate` })
    const refusal = scope_refusal(toBase64(await tx.build({ onlyTransactionKind: true })))
    expect(refusal?.sponsor_reason).toBeUndefined()
    expect(S.sponsor_error_response(refusal)).toEqual({ error: refusal.message })
  })

  test('a message that merely LOOKS like a tagged refusal is NOT tagged (no text-derived reasons)', () => {
    // The old encoder read the reason off the message prefix, so any copy carrying that prefix was "machine
    // readable" — and a copy edit could silently untag a money refusal. The reason lives on the error now.
    expect(S.sponsor_error_response(new Error(`${S.WOULD_ABORT_ERROR_PREFIX} something`))).toEqual({
      error: `${S.WOULD_ABORT_ERROR_PREFIX} something`,
    })
  })

  test('the daily stats expose a counter per refusal class (abort / unreadable / infrastructure)', () => {
    expect(S.sponsor_stats().refused).toHaveProperty('abort')
    expect(S.sponsor_stats().refused).toHaveProperty('sim_unreadable')
    expect(S.sponsor_stats().refused).toHaveProperty('sim_infra')
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLASS GATE. "May this simulation be priced?" is ONE question with two implementations — the sponsor's
// (server, pre-sponsorship) and the client's gas_guard (browser, pre-signature). They are not allowed to
// disagree: the whole bug was one of them answering "yes" where the other answers "no". Any future edit to
// either that changes a verdict reddens here.
describe('PARITY: the sponsor gate and the client gas_guard classify the same simulation identically', () => {
  const corpus = [
    ['passing', ok_sim],
    ['tagged MoveAbort', failed_tagged(MOVE_ABORT_CRANK_107)],
    ['untagged MoveAbort', failed_untagged(MOVE_ABORT_CRANK_107)],
    ['tagged InputObjectDeleted', failed_tagged(INPUT_OBJECT_DELETED)],
    ['untagged InputObjectDeleted', failed_untagged(INPUT_OBJECT_DELETED)],
    ['failure with no error string', failed_tagged(undefined)],
    ['empty result', {}],
    ['null result', null],
    ['no effects', { $kind: 'Transaction', Transaction: {} }],
    ['effects with no status', { $kind: 'Transaction', Transaction: { effects: { gasUsed: gas_used } } }],
    ['status with no success', { $kind: 'Transaction', Transaction: { effects: { status: {}, gasUsed: gas_used } } }],
    [
      'non-boolean success',
      { $kind: 'Transaction', Transaction: { effects: { status: { success: 'false' }, gasUsed: gas_used } } },
    ],
    [
      'unknown union tag',
      { $kind: 'SomethingElse', Transaction: { effects: { status: { success: true }, gasUsed: gas_used } } },
    ],
    ['missing union tag', { Transaction: { effects: { status: { success: true }, gasUsed: gas_used } } }],
  ]
  for (const [name, sim] of corpus)
    test(`${name}: sponsor-accepts === gas_guard-accepts`, () => {
      expect(S.classify_simulation(sim).ok).toBe(gas_guard_decision(sim).reason !== 'sim_failed')
    })
})

// ── SDK CONTRACT TRIPWIRE. Both homes read a shape they do not own: `{ $kind, Transaction|FailedTransaction }`
// with a strict-boolean `status.success`, produced by @mysten/sui's gRPC core. The fixtures above model that
// shape from the installed SDK's source. A version bump can change it, and the fixtures would go on passing
// while production drifted — so the bump has to come through here and be re-read against dist/grpc/core.mjs.
test('the @mysten/sui version whose envelope shape these fixtures model has not moved', () => {
  expect(sui_package.version).toBe('2.20.3')
})
