// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1284 — the framework-rev rule as a unit test. The fixtures are the real shapes: the `Sui`/`Sui_1`
// pair a dependency's own transitive edge produces (the FeatureNotYetSupported condition), and the
// floating `rev = "testnet"` that lets a second lineage back in on the next resolution.
import { expect, test } from 'bun:test'

import {
  dual_rev_violations,
  floating_rev_violations,
  parse_lock_framework_revs,
} from './check_move_lock_revs.mjs'

const rev_a = 'a'.repeat(40)
const rev_b = 'b'.repeat(40)
const framework = (name, rev, sub) =>
  `[pinned.testnet.${name}]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/${sub}", rev = "${rev}" }
use_environment = "testnet"
deps = {}
`

test('a lock with one rev per framework is clean', () => {
  const rows = parse_lock_framework_revs(
    framework('Sui', rev_a, 'sui-framework') +
      framework('MoveStdlib', rev_a, 'move-stdlib')
  )
  expect(rows).toHaveLength(2)
  expect(dual_rev_violations(rows)).toEqual([])
})

test('the Sui/Sui_1 pair a transitive edge produces is a violation, named per entry', () => {
  const rows = parse_lock_framework_revs(
    framework('Sui', rev_a, 'sui-framework') +
      framework('Sui_1', rev_b, 'sui-framework')
  )
  const [violation] = dual_rev_violations(rows)
  expect(violation.key).toBe('testnet/sui-framework')
  expect(violation.revs).toEqual([
    { rev: rev_a, names: ['Sui'] },
    { rev: rev_b, names: ['Sui_1'] },
  ])
})

test('environments are judged independently — testnet duals do not hide behind a clean mainnet', () => {
  const lock =
    framework('Sui', rev_a, 'sui-framework') +
    framework('Sui_1', rev_b, 'sui-framework') +
    `[pinned.mainnet.Sui]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "${rev_a}" }
deps = {}
`
  expect(
    dual_rev_violations(parse_lock_framework_revs(lock)).map((v) => v.key)
  ).toEqual(['testnet/sui-framework'])
})

test('local and root entries carry no rev and are skipped by shape', () => {
  const lock = `[pinned.testnet.aresrpg]
source = { local = "../aresrpg" }
deps = {}

[pinned.testnet.aresrpg_kolizeum]
source = { root = true }
deps = {}
`
  expect(parse_lock_framework_revs(lock)).toEqual([])
})

test('a branch name where a commit belongs is a floating rev; a 40-hex commit is a pin', () => {
  const manifest = `[package]
name = "aresrpg"

[dependencies.Kiosk]
git = "https://github.com/MystenLabs/apps.git"
subdir = "kiosk"
rev = "testnet"

[dependencies.Sui]
git = "https://github.com/MystenLabs/sui.git"
rev = "${rev_a}"
override = true

[addresses]
treasury = "0x0"
`
  expect(floating_rev_violations(manifest)).toEqual([
    { dep: 'Kiosk', rev: 'testnet' },
  ])
})

test('a local dependency is not a git dependency, whatever follows it', () => {
  const manifest = `[dependencies.aresrpg_foundation]
local = "../foundation"

[environments]
testnet = { chain-id = "4c78adac" }
`
  expect(floating_rev_violations(manifest)).toEqual([])
})
