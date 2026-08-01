// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs COMMAND-GRAPH scope: a sponsored PTB rides on the STATION'S gas coin, so the scope check has
// to hold for the WHOLE command graph, not just its MoveCalls. Two halves, both here:
//
//   sad paths — a command kind outside the allowlist, and every shape that draws value from the sponsored gas
//   coin (spent, transferred, or laundered through a framework call), must REFUSE;
//   happy corpus — every PTB the game's composers emit is read from the ONE shared corpus
//   (packages/sdk/test/_composed_transactions.js) the Move-signature census also reads, and partitioned: the
//   gas-drawing compositions are the game's SELF-PAY money PTBs and must refuse, everything else — the actual
//   sponsored gameplay surface — must pass. A composer that starts emitting a new command kind reddens this
//   money-path test instead of surprising production.
//
//   bun test api/sponsor.command_graph.test.js        (no Redis, no station — pure scope decisions)
//
// Own process on purpose (like the sibling allowlist suites): sponsor.mjs resolves its allowlist ONCE at
// module load.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }
import { composed_transactions } from '../packages/sdk/test/_composed_transactions.js'

process.env.REDIS_URL = ''
delete process.env.SPONSOR_ARESRPG_PACKAGES // release.json derivation — so the ids below are really allowlisted

const S = await import('./sponsor.mjs')

const ARES = release.networks.testnet.packages.aresrpg.latest
const SUI_FRAMEWORK = `0x${'2'.padStart(64, '0')}`
const ATTACKER = `0x${'a'.repeat(64)}`
const GAS_DRAW = /draws value from the sponsored gas coin/
const kind_bytes = async (tx) => toBase64(await tx.build({ onlyTransactionKind: true }))
/** An allowlisted aresrpg call — the ticket every hostile PTB below tries to ride in on. */
const game_call = (tx) => tx.moveCall({ target: `${ARES}::game::act`, arguments: [] })
const commands_of = (tx) => tx.getData().commands
const draws_gas = (tx) =>
  commands_of(tx).some(
    (command) =>
      command.$kind === 'SplitCoins' &&
      [command.SplitCoins.coin, ...(command.SplitCoins.amounts ?? [])].some((a) => a?.$kind === 'GasCoin')
  )

describe('the sponsored gas coin is never a source of value', () => {
  test('allowed call + gas split + transfer to a third party → REFUSED', async () => {
    const tx = new Transaction()
    game_call(tx)
    const [stolen] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000n)])
    tx.transferObjects([stolen], tx.pure.address(ATTACKER))
    const kind = await kind_bytes(tx)
    expect(() => S.assert_ptb_scope(kind)).toThrow(GAS_DRAW)
  })

  test('allowed call + the whole gas coin transferred away → REFUSED', async () => {
    const tx = new Transaction()
    game_call(tx)
    tx.transferObjects([tx.gas], tx.pure.address(ATTACKER))
    const kind = await kind_bytes(tx)
    expect(() => S.assert_ptb_scope(kind)).toThrow()
  })

  test('allowed call + gas handed straight to a framework transfer → REFUSED', async () => {
    const tx = new Transaction()
    game_call(tx)
    tx.moveCall({
      target: `${SUI_FRAMEWORK}::transfer::public_transfer`,
      typeArguments: [`${SUI_FRAMEWORK}::coin::Coin<${SUI_FRAMEWORK}::sui::SUI>`],
      arguments: [tx.gas, tx.pure.address(ATTACKER)],
    })
    const kind = await kind_bytes(tx)
    expect(() => S.assert_ptb_scope(kind)).toThrow(GAS_DRAW)
  })

  test('a gas split that only funds an allowlisted game call is STILL refused — the station pays gas, not prices', async () => {
    const tx = new Transaction()
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(10n)])
    tx.moveCall({ target: `${ARES}::shop::buy`, arguments: [payment] })
    const kind = await kind_bytes(tx)
    expect(() => S.assert_ptb_scope(kind)).toThrow(GAS_DRAW)
  })
})

describe('command KINDS are an allowlist — an unrecognised shape refuses, never rides along', () => {
  test('TransferObjects (no composer emits one) → REFUSED', async () => {
    const tx = new Transaction()
    game_call(tx)
    tx.transferObjects(
      [tx.objectRef({ objectId: `0x${'b'.repeat(64)}`, version: '1', digest: '1'.repeat(32) })],
      tx.pure.address(ATTACKER)
    )
    const kind = await kind_bytes(tx)
    expect(() => S.assert_ptb_scope(kind)).toThrow(/is a TransferObjects — only .* commands are sponsored/)
  })

  test('MergeCoins / MakeMoveVec → REFUSED', () => {
    expect(() =>
      S.assert_command_graph([{ $kind: 'MergeCoins', MergeCoins: { destination: {}, sources: [] } }])
    ).toThrow(/is a MergeCoins/)
    expect(() => S.assert_command_graph([{ $kind: 'MakeMoveVec', MakeMoveVec: { elements: [] } }])).toThrow(
      /is a MakeMoveVec/
    )
  })

  test('the publish/upgrade refusal keeps its own copy', () => {
    expect(() => S.assert_command_graph([{ $kind: 'Publish', Publish: {} }])).toThrow(/publishes\/upgrades/)
    expect(() => S.assert_command_graph([{ $kind: 'Upgrade', Upgrade: {} }])).toThrow(/publishes\/upgrades/)
  })
})

describe('the real SDK corpus, partitioned', () => {
  const corpus = composed_transactions()

  test('the corpus is the census — never let it silently empty out', () => {
    expect(corpus.length).toBeGreaterThan(30)
    expect(corpus.filter(draws_gas).length).toBeGreaterThan(0) // the self-pay money PTBs
    expect(corpus.filter((tx) => !draws_gas(tx)).length).toBeGreaterThan(20) // the sponsored gameplay surface
  })

  test('every composer emits ONLY sponsorable command kinds', () => {
    const kinds = new Set(corpus.flatMap((tx) => commands_of(tx).map((command) => command.$kind)))
    expect([...kinds].filter((command_kind) => !S.SPONSORABLE_COMMAND_KINDS.includes(command_kind))).toEqual([])
  })

  test('every gameplay composition passes, and exactly the gas-drawing ones refuse', () => {
    for (const transaction of corpus) {
      const check = () => S.assert_command_graph(commands_of(transaction))
      if (draws_gas(transaction)) expect(check).toThrow(GAS_DRAW)
      else expect(check).not.toThrow()
    }
  })
})
