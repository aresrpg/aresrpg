// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

// Exactly as the gate script spells them: two src suites behind its $FE prefix, and the room transport suite
// at its full path (it lives under packages/frontend/test, per L-L1).
const EXPECTED_COMBO = [
  '$FE/world-shell/dungeon_fight_weapon_lines.test.js',
  '$FE/simulator/fight_open_hand.test.js',
  'packages/frontend/test/p2p/lobby-room.test.js',
]

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const actual_state = async () => {
  const [presence, fight, order_gate, permuted] = await Promise.all([
    source('packages/frontend/test/p2p/lobby-room.test.js'),
    source('packages/frontend/src/simulator/fight_open_hand.test.js'),
    source('scripts/order-independence-gate.sh'),
    source('scripts/permuted-suite.sh'),
  ])

  return {
    consumers: [
      {
        id: 'presence',
        // leave_room() dispatches the presence atom's `reset` input — the room suite's cold-state idiom.
        reset_index: presence.indexOf('  leave_room() // an earlier suite may have left a room mounted'),
        first_use_index: presence.indexOf("describe('the room IS the world"),
      },
      {
        id: 'fight',
        reset_index: fight.indexOf('beforeEach(reset_fight_core)'),
        first_use_index: fight.indexOf("test('a level-200 roster row"),
      },
    ],
    combo: EXPECTED_COMBO.filter((file) => order_gate.includes(file)),
    combo_label: order_gate.includes('consumers self-reset behind a warmed session'),
    permuted_seed: permuted.includes('PERMUTED_SEED:-1729'),
    permuted_runs_bun: permuted.includes('bun test "${FILES[@]}"'),
  }
}

const fixture_arg = process.argv.indexOf('--fixture')
const state =
  fixture_arg === -1 ? await actual_state() : JSON.parse(await readFile(process.argv[fixture_arg + 1], 'utf8'))

const failures = []
for (const id of ['presence', 'fight']) {
  const consumer = state.consumers?.find((candidate) => candidate.id === id)
  if (!consumer || consumer.reset_index < 0 || consumer.reset_index >= consumer.first_use_index) {
    failures.push(`${id} reset must run before first singleton use`)
  }
}

if (JSON.stringify(state.combo) !== JSON.stringify(EXPECTED_COMBO) || !state.combo_label) {
  failures.push('the warmed-session three-suite combination changed')
}
if (!state.permuted_seed || !state.permuted_runs_bun) {
  failures.push('the seeded whole-suite permutation probe is not armed')
}

if (failures.length) {
  console.error('SINGLETON ORDER CONVENTION FAILED')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('SINGLETON ORDER CONVENTION PASSED: 2 consumers reset before use')
