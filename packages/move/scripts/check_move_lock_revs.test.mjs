// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1284 — the framework-rev rule as a unit test. The fixtures are the real shapes: the `Sui`/`Sui_1`
// pair a dependency's own transitive edge produces (the FeatureNotYetSupported condition), and the
// floating `rev = "testnet"` that lets a second lineage back in on the next resolution.
import { expect, test } from 'bun:test'

import {
  dual_rev_violations,
  expected_cli_commit,
  floating_rev_violations,
  matrix_violations,
  parse_lock_framework_revs,
  parse_lock_git_pins,
  parse_manifest,
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
    framework('Sui', rev_a, 'sui-framework') + framework('MoveStdlib', rev_a, 'move-stdlib')
  )
  expect(rows).toHaveLength(2)
  expect(dual_rev_violations(rows)).toEqual([])
})

test('the Sui/Sui_1 pair a transitive edge produces is a violation, named per entry', () => {
  const rows = parse_lock_framework_revs(
    framework('Sui', rev_a, 'sui-framework') + framework('Sui_1', rev_b, 'sui-framework')
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
  expect(dual_rev_violations(parse_lock_framework_revs(lock)).map((v) => v.key)).toEqual(['testnet/sui-framework'])
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
  expect(floating_rev_violations(manifest)).toEqual([{ dep: 'Kiosk', rev: 'testnet' }])
})

test('a local dependency is not a git dependency, whatever follows it', () => {
  const manifest = `[dependencies.aresrpg_foundation]
local = "../foundation"

[environments]
testnet = { chain-id = "4c78adac" }
`
  expect(floating_rev_violations(manifest)).toEqual([])
})

// ── The exact matrix (#1305 review) ─────────────────────────────────────────────────────────────
// "At most one rev per environment" was satisfied by an empty lock, a missing environment, the two
// frameworks at different single revs, any arbitrary rev, and a wrong Kiosk pin. Every row below is
// one of those false greens; the first is the aligned tree, which must still pass.
const CLI = '6effb4523834cf2536be21d8ebe577b0cc9e0160'
const KIOSK = 'a'.repeat(40)
const framework_src = (sub, rev) =>
  `source = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/${sub}", rev = "${rev}" }`
const MANIFEST = `[package]
name = "x"
[dependencies.Sui]
git = "https://github.com/MystenLabs/sui.git"
rev = "${CLI}"
[dependencies.MoveStdlib]
git = "https://github.com/MystenLabs/sui.git"
rev = "${CLI}"
[dependencies.Kiosk]
git = "https://github.com/MystenLabs/apps.git"
rev = "${KIOSK}"
[environments]
testnet = { chain-id = "4c78adac" }
mainnet = { chain-id = "35834a8a" }
`
const env_block = (env, sui, std, kiosk) => `[pinned.${env}.Sui]
${framework_src('sui-framework', sui)}
[pinned.${env}.MoveStdlib]
${framework_src('move-stdlib', std)}
[pinned.${env}.Kiosk]
source = { git = "https://github.com/MystenLabs/apps.git", subdir = "kiosk", rev = "${kiosk}" }
`
const verdict = (lock) => {
  const rows = parse_lock_framework_revs(lock)
  return [
    ...dual_rev_violations(rows).map((v) => `${v.key} dual`),
    ...matrix_violations({
      manifest: parse_manifest(MANIFEST),
      rows,
      pins: parse_lock_git_pins(lock),
      expected_commit: '6effb4523834',
    }),
  ]
}
const ALIGNED = env_block('testnet', CLI, CLI, KIOSK) + env_block('mainnet', CLI, CLI, KIOSK)

test('the aligned matrix passes — the gate is satisfiable', () => {
  expect(verdict(ALIGNED)).toEqual([])
})

test('an INDENTED dual table is caught — the line parser read past it', () => {
  const lock = ALIGNED + `  [pinned.testnet.Sui_1]\n  ${framework_src('sui-framework', 'b'.repeat(40))}\n`
  expect(verdict(lock)[0]).toContain('dual')
})

test('an empty or environment-missing lock is a violation, not a pass', () => {
  expect(verdict('')[0]).toContain('testnet')
  expect(verdict(env_block('testnet', CLI, CLI, KIOSK))[0]).toContain('mainnet')
})

test('the two frameworks must agree with each other AND with the manifest', () => {
  expect(
    verdict(env_block('testnet', CLI, 'c'.repeat(40), KIOSK) + env_block('mainnet', CLI, CLI, KIOSK))[0]
  ).toContain('MoveStdlib')
  const arbitrary = 'd'.repeat(40)
  expect(
    verdict(env_block('testnet', arbitrary, arbitrary, KIOSK) + env_block('mainnet', arbitrary, arbitrary, KIOSK))[0]
  ).toContain('manifest pins')
})

test('a non-framework git dependency must match its manifest pin too', () => {
  expect(verdict(env_block('testnet', CLI, CLI, 'e'.repeat(40)) + env_block('mainnet', CLI, CLI, KIOSK))[0]).toContain(
    'Kiosk'
  )
})

test("the toolchain commit comes from CI's own sui pin", () => {
  expect(expected_cli_commit('          SUI_VERSION: sui 1.76.0-6effb4523834\n')).toBe('6effb4523834')
  expect(expected_cli_commit('nothing here')).toBe(null)
})

test('comments and quoted hashes do not confuse the parser', () => {
  const lock = `# a comment with [pinned.testnet.Sui] inside it\n${ALIGNED}`
  expect(verdict(lock)).toEqual([])
})
