// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PTB INPUT CAP regression — PHASE 8 spells, 2026-08-01.
//
// THE DEFECT: the SDK allocates a FRESH PTB input for every `tx.pure` call, and the spell builders emit 11
// pures per EFFECT + 13 pures + 2 empty u16 vectors per LEVEL — hundreds of them identical (element 255,
// chance 100, the zero/255 defaults, the two empty vectors). Measured against the live corpus, the phase's
// own `richest(pending, cap)` probe batch of 3 rows built 2070 inputs against the protocol's 2048 cap:
// `programmable transaction has too many inputs: 2070 (limit 2048)`, refused at dry-run, phase dead, zero
// gas burned. `fitByInputs` could not save it — it trims REAL batches, never the probe that precedes them.
//
// THE FIX: a per-Transaction memo (seed_full_corpus.mjs `pure()`) hands the SAME input handle back for a
// repeated (kind, value). Reading one input from many arguments is PTB-legal — a Move argument READS an
// input, it does not consume it — so the collapse is invisible to the chain and to the minted templates.
//
// This drives the REAL exported builders (`effectFx`/`spellLevel`), not a replica: the client module is
// mocked because seed_full_corpus.mjs resolves a signer at import time, and nothing else in it runs on
// import. Coverage: the cap itself, byte-exact argument semantics under collapse, per-tx isolation, and
// the over-collapse guard (a u8 3 is not a u64 3).

import { describe, test, expect, mock } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

const ADDRESS = `0x${'11'.repeat(32)}`
mock.module('./client.js', () => ({
  NETWORK: 'localnet',
  keypair: { getPublicKey: () => ({ toSuiAddress: () => ADDRESS }) },
  sui_client: {},
}))
const { effectFx, spellLevel } = await import('./seed_full_corpus.mjs')

const PTB_INPUT_CAP = 2048 // the protocol's hard ceiling — the refusal above quoted it verbatim

/** The corpus's fattest authored shape (seed/mainnet/spells/shusen.json `shusen_deep_draught`, measured
 *  2026-08-01): 6 levels × 12 effects = 72 effects, which pre-fix priced at 887 pure inputs for ONE row. */
const worst_case_row = () => ({
  classType: 'shusen',
  unlock: 54,
  id: 'shusen_deep_draught',
  levels: Array.from({ length: 6 }, (_, level) => ({
    min_char_level: 54 + level,
    ap_cost: 6,
    range_min: 0,
    range_max: 0,
    modifiable_range: false,
    line_launch: false,
    line_of_sight: false,
    free_cell: false,
    casts_per_turn: 255,
    casts_per_target: 255,
    cooldown_turns: 10,
    crit_rate: 50,
    // 12 effects/level in the authored corpus: a zone-rich damage spread plus its crit mirror.
    effects: Array.from({ length: 8 }, (_, i) => ({
      kind: 1,
      value: 10 + level,
      element: i % 4,
      target_filter: 1,
      chance: 100,
      area_shape: 1,
      area_size: 5,
      stat: 0,
      turns: 0,
    })),
    crit_effects: Array.from({ length: 4 }, (_, i) => ({
      kind: 1,
      value: 20 + level,
      element: i % 4,
      target_filter: 1,
      chance: 100,
      area_shape: 1,
      area_size: 5,
      stat: 0,
      turns: 0,
    })),
  })),
})

/** The PHASE 8 row compose, verbatim from seed_full_corpus.mjs `buildSpellsInto` (which is function-local
 *  to the seeder's async body); every pure it threads runs through the REAL memoized builders. */
const build_rows = (tx, rows) => {
  for (const sp of rows) {
    const levels = sp.levels.map((lvl) =>
      spellLevel(
        tx,
        {
          min_cl: lvl.min_char_level,
          ap: lvl.ap_cost,
          rmin: lvl.range_min,
          rmax: lvl.range_max,
          mod: lvl.modifiable_range,
          line: lvl.line_launch,
          los: lvl.line_of_sight,
          free: lvl.free_cell,
          cpt: lvl.casts_per_turn,
          cpta: lvl.casts_per_target,
          cd: lvl.cooldown_turns,
          crit: lvl.crit_rate,
        },
        (lvl.effects ?? []).map((e) => effectFx(tx, e)),
        (lvl.crit_effects ?? []).map((e) => effectFx(tx, e))
      )
    )
    tx.moveCall({
      target: `${ADDRESS}::spell_template::mint_spell`,
      arguments: [
        tx.object(ADDRESS),
        tx.object(ADDRESS),
        tx.pure.string(sp.classType),
        tx.pure.u16(sp.unlock),
        tx.pure.string(sp.id),
        tx.makeMoveVec({
          type: `${ADDRESS}::spell_effect::SpellLevel`,
          elements: levels,
        }),
        tx.pure.u64(30),
        tx.pure.u64(9),
        tx.object(ADDRESS),
      ],
    })
  }
}

const built = (rows) => {
  const tx = new Transaction()
  build_rows(tx, rows)
  return tx.getData()
}
const count_inputs = (rows) => built(rows).inputs.length

/** The bytes an input actually carries — the only thing the chain ever sees. */
const input_bytes = (data, index) => [
  ...Buffer.from(data.inputs[index].Pure.bytes, 'base64'),
]
/** Resolve a command argument through the input table to its wire bytes. */
const argument_bytes = (data, command_index, argument_index) => {
  const argument =
    data.commands[command_index].MoveCall.arguments[argument_index]
  expect(argument.$kind).toBe('Input')
  return input_bytes(data, argument.Input)
}

describe('PHASE 8 spells — repeated pure inputs must not blow the 2048 PTB input cap', () => {
  test('THE REGRESSION: the probe-sized batch of the corpus worst case stays under the protocol cap', () => {
    // Pre-fix arithmetic on this exact shape: (72 effects × 11) + (6 levels × 15) + 5 = 887 inputs per row,
    // so the 3-row probe batch priced at ~2661 — over the cap, exactly the class of the live 2070 refusal.
    const rows = [1, 2, 3].map((n) => ({
      ...worst_case_row(),
      id: `shusen_deep_draught_${n}`,
    }))
    const inputs = count_inputs(rows)
    expect(inputs).toBeLessThan(PTB_INPUT_CAP)
    // And with real headroom, not by a byte — the seeder's own INPUT_CAP trim line sits at 1900.
    expect(inputs).toBeLessThan(1900)
  })

  test('one row collapses from 887 pure inputs to a handful of distinct values', () => {
    const inputs = count_inputs([worst_case_row()])
    expect(inputs).toBeLessThan(120) // ≥86% collapse; the row only holds a few dozen distinct values
  })

  test('only INPUTS collapse — the command list is untouched, so the mint is the same mint', () => {
    // Per row, shape-derived: 72 new_effect + 12 effect makeMoveVec + 6 new_spell_level + 1 level
    // makeMoveVec + 1 mint_spell = 92 commands. Memoizing a value must never merge two CALLS.
    expect(built([worst_case_row()]).commands.length).toBe(92)
    const rows = [1, 2, 3].map((n) => ({ ...worst_case_row(), id: `r${n}` }))
    expect(built(rows).commands.length).toBe(92 * 3)
  })

  describe('collapsing must not change what the chain reads', () => {
    test('every new_effect argument still resolves to its own value, byte for byte', () => {
      const tx = new Transaction()
      // `turns` deliberately equals `element` (3): the two arguments MUST share one input and both read 0x03.
      effectFx(tx, {
        kind: 7,
        element: 3,
        value: 12,
        area_shape: 1,
        area_size: 5,
        target_filter: 2,
        chance: 55,
        turns: 3,
        stat: 9,
      })
      const data = tx.getData()
      const u8 = (v) => [v]
      const u64 = (v) => [v, 0, 0, 0, 0, 0, 0, 0]
      // new_effect(kind, element, value, area_shape, area_size, target_filter, chance, turns, stat, flags, phase)
      const expected = [
        u8(7),
        u8(3),
        u64(12),
        u8(1),
        u64(5),
        u8(2),
        u8(55),
        u8(3),
        u8(9),
        u8(0),
        u8(0),
      ]
      expected.forEach((bytes, i) =>
        expect(argument_bytes(data, 0, i)).toEqual(bytes)
      )
      // …and the equal-valued pair really did share ONE input (the collapse under test, not a coincidence).
      const args = data.commands[0].MoveCall.arguments
      expect(args[1].Input).toBe(args[7].Input)
    })

    test('a u8 3 is never confused with a u64 3 — distinct wire types keep distinct inputs', () => {
      const tx = new Transaction()
      // kind:3 (u8) and area_size:3 (u64) share a numeric value but not a serialization.
      effectFx(tx, {
        kind: 3,
        element: 0,
        value: 0,
        area_size: 3,
        chance: 0,
        turns: 0,
      })
      const data = tx.getData()
      expect(argument_bytes(data, 0, 0)).toEqual([3])
      expect(argument_bytes(data, 0, 4)).toEqual([3, 0, 0, 0, 0, 0, 0, 0])
    })

    test('the memo is PER-TRANSACTION — a handle never leaks across PTBs', () => {
      const effect = { kind: 1, element: 255, value: 4, chance: 100, turns: 0 }
      const first = new Transaction()
      effectFx(first, effect)
      const before = first.getData().inputs.length
      const second = new Transaction()
      effectFx(second, effect)
      // The second PTB builds its OWN inputs from zero; an input index means nothing in another transaction.
      expect(second.getData().inputs.length).toBe(before)
      expect(before).toBeGreaterThan(0)
    })
  })
})
