// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { ci_checks_for_diff, browser_checks_required, source_checks_for_diff } from '../ci_inputs.mjs'
import { SCENE_COMPILER_FILES } from '../release_inputs.mjs'

test('scene recipes, artifacts and every scene compiler input launch browser checks', () => {
  for (const path of ['seed/scenes/main_menu.recipe.json', 'seed/scenes/main_menu.json', ...SCENE_COMPILER_FILES])
    expect(browser_checks_required([path], () => false)).toBe(true)
})

for (const path of [
  'seed/content/items.json',
  'seed/content/worlds.json',
  'packages/journal/content/article.md',
  'packages/journal/artwork/cover.png',
  'packages/move/sources/fight.move',
  'packages/move/Move.lock',
  'packages/seed/Move.toml',
  'pins.json',
  'README.md',
])
  test(`${path} does not launch browser workloads`, () =>
    expect(browser_checks_required([path], () => true)).toBe(false))

for (const path of [
  'packages/engine/src/renderer.ts',
  'packages/ui/src/controls.tsx',
  'packages/frontend/src/app.tsx',
  'packages/sdk/src/client.ts',
  'packages/fight/src/index.ts',
  'packages/immutable/src/index.ts',
  'packages/protocol/src/index.ts',
  'packages/frontend/e2e/playwright.config.ts',
  'seed/models/body.glb',
  'bun.lock',
  'patches/vite@8.3.0.patch',
  'scripts/pin_vercel_deployment.ts',
  'scripts/prepare_browser.mjs',
  '.github/workflows/gate.yml',
  'scripts/ci_inputs.mjs',
])
  test(`${path} requires browser verification`, () => expect(browser_checks_required([path], () => true)).toBe(true))

test('version-only bumps skip browsers but dependency and script changes do not', () => {
  const git = (updated) => (args) => {
    if (args[0] === 'diff') return 'package.json\0'
    if (args[0] === 'ls-tree') return 'package.json'
    return JSON.stringify(args[1].startsWith('base:') ? { version: '1.0.0', scripts: { dev: 'vite' } } : updated)
  }
  expect(ci_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'vite' } })).browsers).toBe(false)
  expect(ci_checks_for_diff('base', 'head', git({ version: '1.0.1', scripts: { dev: 'other' } })).browsers).toBe(true)
})

test('missing baseline fails safe and Git errors never become a skip', () => {
  expect(
    ci_checks_for_diff('', 'head', () => {
      throw new Error('must not read')
    })
  ).toEqual({ browsers: true, move: true, indexer: true })
  expect(() =>
    ci_checks_for_diff('base', 'head', () => {
      throw new Error('missing history')
    })
  ).toThrow('missing history')
})

test('a rendering edit remains required across a later version-only commit', () => {
  expect(browser_checks_required(['package.json', 'packages/engine/src/renderer.ts'], () => false)).toBe(true)
})

for (const path of ['seed/content/mobs.json', 'seed/content/spells.json', 'pins.json', 'README.md'])
  test(`${path} does not rerun unchanged compiled-language checks`, () => {
    expect(ci_checks_for_diff('verified', 'head', () => `${path}\0`)).toEqual({
      browsers: false,
      move: false,
      indexer: false,
    })
  })

for (const path of [
  'packages/move/sources/world.move',
  'packages/move-math/Move.lock',
  'packages/seed/Move.toml',
  'packages/control/sources/version.move',
  'packages/kares/sources/staking.move',
  'packages/move-combat/tests/fight.move',
  'scripts/coverage_move.sh',
  'scripts/assert_rewards_coverage.mjs',
  'move-packages.json',
  '.github/workflows/gate.yml',
])
  test(`${path} requires Move and its indexer parity checks`, () => {
    const checks = ci_checks_for_diff('verified', 'head', () => `${path}\0`)
    expect(checks.move).toBe(true)
    expect(checks.indexer).toBe(true)
  })

for (const path of [
  'packages/indexer/Cargo.lock',
  'packages/immutable/src/leaderboards.ts',
  'packages/indexer/tests/layout_snapshot.txt',
  'packages/protocol/src/leaderboards.ts',
  'scripts/coverage_indexer.sh',
  '.github/actions/setup-redis/action.yml',
  'rust-toolchain.toml',
  '.cargo/config.toml',
])
  test(`${path} requires indexer verification`, () => {
    expect(ci_checks_for_diff('verified', 'head', () => `${path}\0`).indexer).toBe(true)
  })

test('a failed Move edit still runs when followed by a content-only update', () => {
  const git = (args) => {
    expect(args).toEqual(['diff', '--name-only', '--no-renames', '-z', 'last-success', 'head'])
    return 'packages/move/sources/world.move\0seed/content/mobs.json\0'
  }
  expect(ci_checks_for_diff('last-success', 'head', git)).toEqual({ browsers: false, move: true, indexer: true })
})

const gate_source = (browser = 'browser', move = 'move', header = 'name: gate') =>
  `${header}\njobs:\n  changes:\n    run: classify\n  source:\n    run: source\n  tests_move:\n    run: ${move}\n  tests_indexer:\n    run: indexer\n  browsers:\n    run: ${browser}\n`
const workflow_git = (before, after) => (args) => {
  if (args[0] === 'diff') return '.github/workflows/gate.yml\0'
  if (args[0] === 'ls-tree') return '.github/workflows/gate.yml'
  return args[1].startsWith('base:') ? before : after
}

test('browser-only workflow edits do not invalidate compiled-language lanes', () => {
  expect(ci_checks_for_diff('base', 'head', workflow_git(gate_source(), gate_source('new browser')))).toEqual({
    browsers: true,
    move: false,
    indexer: false,
  })
})

test('Move workflow and shared workflow edits retain required verification', () => {
  expect(ci_checks_for_diff('base', 'head', workflow_git(gate_source(), gate_source('browser', 'new move')))).toEqual({
    browsers: false,
    move: true,
    indexer: true,
  })
  expect(
    ci_checks_for_diff('base', 'head', workflow_git(gate_source(), gate_source('browser', 'move', 'name: new')))
  ).toEqual({ browsers: true, move: true, indexer: true })
})

test('classifier source edits run source/browser verification without rerunning unchanged Rust or Move', () => {
  expect(ci_checks_for_diff('verified', 'head', () => 'scripts/ci_inputs.mjs\0')).toEqual({
    browsers: true,
    move: false,
    indexer: false,
  })
})

test('source-only and indexer-only workflow edits select only their owners', () => {
  const original = gate_source()
  expect(
    ci_checks_for_diff('base', 'head', workflow_git(original, original.replace('run: source', 'run: parallel source')))
  ).toEqual({ browsers: false, move: false, indexer: false })
  expect(
    ci_checks_for_diff('base', 'head', workflow_git(original, original.replace('run: indexer', 'run: updated indexer')))
  ).toEqual({ browsers: false, move: false, indexer: true })
})

for (const changed of [
  null,
  'jobs: {}',
  gate_source() + 'env:\n  TOOLCHAIN: new\n',
  gate_source().replace('run: browser', 'run: *shared'),
])
  test('unknown workflow structure cannot silently skip verification', () => {
    expect(ci_checks_for_diff('base', 'head', workflow_git(gate_source(), changed))).toEqual({
      browsers: true,
      move: true,
      indexer: true,
    })
  })

test('changes to shared lane-selection setup run all verification', () => {
  const original = gate_source()
  expect(
    ci_checks_for_diff('base', 'head', workflow_git(original, original.replace('run: classify', 'run: new classifier')))
  ).toEqual({ browsers: true, move: true, indexer: true })
})

const source_git =
  (paths, before, after, mode = '100644') =>
  (args) => {
    if (args[0] === 'diff') return paths.join('\0')
    if (args[0] === 'ls-tree') return `${mode} blob hash\tpackage.json`
    return args[1].startsWith('base:') ? before : after
  }
const release_manifest = (version) => JSON.stringify({ name: 'aresrpg', version, private: true }, null, 2)

test('successful baseline permits identical inputs and only the root release version change', () => {
  expect(source_checks_for_diff('base', 'head', source_git([], '', ''))).toBe(false)
  expect(
    source_checks_for_diff(
      'base',
      'head',
      source_git(['package.json'], release_manifest('2.8.1'), release_manifest('2.8.2'))
    )
  ).toBe(false)
})

for (const path of [
  'packages/frontend/src/app.tsx',
  'packages/frontend/package.json',
  'bun.lock',
  'bunfig.toml',
  'eslint.config.js',
  '.prettierrc',
  'patches/vite.patch',
  'scripts/ci_inputs.mjs',
  'scripts/release_inputs.mjs',
  '.github/workflows/gate.yml',
  'seed/scenes/main_menu.json',
  'README.md',
])
  test(`${path} cannot reuse source verification across a version bump`, () => {
    expect(source_checks_for_diff('base', 'head', source_git(['package.json', path], '', ''))).toBe(true)
  })

for (const after of [
  release_manifest('2.8.2').replace('"private": true', '"private": false'),
  release_manifest('2.8.2').replace('"private": true', '"dependencies": { "vite": "9" }'),
  release_manifest('2.8.2').replace('"private": true', '"scripts": { "test": "true" }'),
  release_manifest('2.8.2').replace('"private": true', '"packageManager": "bun@9"'),
  release_manifest('2.8.2') + '\n',
  release_manifest('2.8.2-beta'),
  release_manifest('02.8.2'),
  release_manifest('2.8.2').replace('  "version"', '    "version"'),
])
  test('other manifest or unsupported version changes require source verification', () => {
    expect(source_checks_for_diff('base', 'head', source_git(['package.json'], release_manifest('2.8.1'), after))).toBe(
      true
    )
  })

test('root manifest mode changes cannot reuse source verification', () => {
  expect(
    source_checks_for_diff(
      'base',
      'head',
      source_git(['package.json'], release_manifest('2.8.1'), release_manifest('2.8.2'), '100755')
    )
  ).toBe(true)
})

test('source verification requires a successful baseline and never converts missing history into a skip', () => {
  const unavailable = () => {
    throw new Error('missing history')
  }
  expect(source_checks_for_diff('', 'head', unavailable)).toBe(true)
  expect(source_checks_for_diff('000000', 'head', unavailable)).toBe(true)
  expect(() => source_checks_for_diff('base', 'head', unavailable)).toThrow('missing history')
})

const gate_workflow = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
const run_gate = (result, required, changes = 'success') => {
  const values = {
    'needs.changes.result': changes,
    'needs.source.result': result,
    'needs.changes.outputs.source': required,
    'needs.tests_move.result': 'skipped',
    'needs.changes.outputs.move': 'false',
    'needs.tests_indexer.result': 'skipped',
    'needs.changes.outputs.indexer': 'false',
    'needs.browsers.result': 'skipped',
    'needs.changes.outputs.browsers': 'false',
    "github.event_name == 'push' || needs.bundle-gate.result == 'success'": 'true',
  }
  const script = gate_workflow.jobs.gate.steps[0].run.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unexpected gate input: ${key}`)
    return values[key]
  })
  return execFileSync('/bin/bash', ['-e', '-c', script], { encoding: 'utf8' })
}

test('the exact-SHA aggregate gate accepts only justified source skips or successful checks', () => {
  expect(run_gate('skipped', 'false')).toBe('')
  expect(run_gate('success', 'true')).toBe('')
  for (const result of ['failure', 'cancelled', 'skipped']) expect(() => run_gate(result, 'true')).toThrow()
  for (const result of ['failure', 'cancelled']) expect(() => run_gate(result, 'false')).toThrow()
  expect(() => run_gate('skipped', '')).toThrow()
  expect(() => run_gate('skipped', 'false', 'failure')).toThrow()
})

test('source matrix consumes classifier evidence from a successful edge push gate only', () => {
  expect(gate_workflow.jobs.source.needs).toBe('changes')
  expect(gate_workflow.jobs.source.if).toBe("needs.changes.outputs.source == 'true'")
  expect(gate_workflow.jobs.changes.outputs.source).toBe('${{ steps.inputs.outputs.source }}')
  const baseline = gate_workflow.jobs.changes.steps.find(({ id }) => id === 'inputs').run
  expect(baseline).toContain('--workflow gate.yml --branch edge --event push --status success')
  expect(gate_workflow.jobs.gate.needs).toContain('source')
})
