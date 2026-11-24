// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Release tooling core suite, gate half: CI lane selection, the gate verdict, and release
// certification on the first green gate of the same tree.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import { ci_checks_for_diff, source_checks_for_diff } from '../ci_inputs.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const workflow = (name) => Bun.YAML.parse(readFileSync(resolve(ROOT, `.github/workflows/${name}.yml`), 'utf8'))
const with_directory = (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-release-gate-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const bash = (script, options) => execFileSync('/bin/bash', ['-e', '-c', script], { stdio: 'pipe', ...options })
const succeeds = (run) => {
  try {
    run()
    return true
  } catch {
    return false
  }
}
// gh answers the gate state of each commit; command doubles are shell functions, never new executables.
const gate_states = (states) =>
  `gh() { case "$*" in ${Object.entries(states)
    .map(([sha, state]) => `*head_sha=${sha}*) echo ${state} ;;`)
    .join(' ')} *) echo absent ;; esac; }\nsleep() { :; }`

const lanes = (...paths) => ci_checks_for_diff('verified', 'head', () => paths.map((path) => `${path}\0`).join(''))
const NONE = { browsers: false, move: false, indexer: false }
const ALL = { browsers: true, move: true, indexer: true }
const unread = () => {
  throw new Error('must not read history')
}

test('CI runs the Move, indexer and browser lanes only for their inputs, and fails open without evidence', () => {
  const move = { ...NONE, move: true, indexer: true }
  expect(lanes('packages/move/sources/world.move', 'seed/content/mobs.json')).toEqual(move)
  expect(lanes('.github/actions/setup-sui/action.yml')).toEqual(move)
  expect(lanes('packages/indexer/Cargo.lock')).toEqual({ ...NONE, indexer: true })
  expect(lanes('packages/engine/src/renderer.ts')).toEqual({ ...NONE, browsers: true })
  expect(lanes('README.md', 'pins.json', 'seed/content/items.json', 'packages/journal/content/a.md')).toEqual(NONE)
  expect(ci_checks_for_diff('', 'head', unread)).toEqual(ALL)
  expect(() => ci_checks_for_diff('base', 'head', unread)).toThrow('must not read history')
})

test('a gate workflow edit reruns the lanes whose job changed, and every lane when its structure is unknown', () => {
  const gate = (browser = 'browser', move = 'move', header = 'name: gate') =>
    `${header}\njobs:\n  changes:\n    run: classify\n  source:\n    run: source\n  tests_move:\n    run: ${move}\n  tests_indexer:\n    run: indexer\n  browsers:\n    run: ${browser}\n`
  const edit = (after) =>
    ci_checks_for_diff('base', 'head', (args) => {
      if (args[0] === 'diff') return '.github/workflows/gate.yml\0'
      if (args[0] === 'ls-tree') return '.github/workflows/gate.yml'
      return args[1].startsWith('base:') ? gate() : after
    })
  expect(edit(gate('new browser'))).toEqual({ ...NONE, browsers: true })
  expect(edit(gate('browser', 'new move'))).toEqual({ ...NONE, move: true, indexer: true })
  expect(edit(gate().replace('run: source', 'run: other source'))).toEqual(NONE)
  for (const after of [gate('browser', 'move', 'name: new'), gate().replace('classify', 'new'), 'jobs: {}'])
    expect(edit(after)).toEqual(ALL)
})

test('only the root package.json version line may differ for a tree to reuse another tree’s gate', () => {
  const manifest = (version, extra = '') =>
    `{\n  "name": "aresrpg",\n  "version": "${version}",${extra}\n  "private": true\n}`
  const reuse = (paths, after, mode = '100644') =>
    !source_checks_for_diff('base', 'head', (args) => {
      if (args[0] === 'diff') return paths.join('\0')
      if (args[0] === 'ls-tree') return `${mode} blob hash\tpackage.json`
      return args[1].startsWith('base:') ? manifest('2.8.1') : after
    })
  expect(reuse([], '')).toBe(true)
  expect(reuse(['package.json'], manifest('2.8.2'))).toBe(true)
  expect(reuse(['package.json', 'packages/frontend/src/app.tsx'], manifest('2.8.2'))).toBe(false)
  expect(reuse(['package.json'], manifest('2.8.2', '\n  "scripts": { "test": "true" },'))).toBe(false)
  expect(reuse(['package.json'], manifest('2.8.2-beta'))).toBe(false)
  expect(reuse(['package.json'], `${manifest('2.8.2')}\n`)).toBe(false)
  expect(reuse(['package.json'], manifest('2.8.2'), '100755')).toBe(false)
  expect(source_checks_for_diff('', 'head', unread)).toBe(true)
  expect(() => source_checks_for_diff('base', 'head', unread)).toThrow('must not read history')
})

test('the gate verdict is green only when every lane passed or was skipped for want of changed inputs', () => {
  const verdict = ({ lane = 'success', required = 'true', bundle = lane, changes = 'success' }) => {
    const values = {
      'needs.changes.result': changes,
      'needs.source.result': lane,
      'needs.bundle-gate.result': bundle,
      'needs.changes.outputs.source': required,
      'needs.tests_move.result': 'skipped',
      'needs.changes.outputs.move': 'false',
      'needs.tests_indexer.result': 'skipped',
      'needs.changes.outputs.indexer': 'false',
      'needs.browsers.result': 'skipped',
      'needs.changes.outputs.browsers': 'false',
    }
    const script = workflow('gate').jobs.gate.steps[0].run.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`Unexpected gate input: ${key}`)
      return values[key]
    })
    return succeeds(() => bash(script)) ? 'green' : 'red'
  }
  expect(verdict({})).toBe('green')
  expect(verdict({ lane: 'skipped', required: 'false' })).toBe('green')
  for (const lane of ['failure', 'cancelled', 'skipped']) expect(verdict({ lane })).toBe('red')
  expect(verdict({ bundle: 'failure' })).toBe('red')
  expect(verdict({ bundle: 'skipped' })).toBe('red')
  expect(verdict({ lane: 'failure', required: 'false' })).toBe('red')
  expect(verdict({ lane: 'skipped', required: '' })).toBe('red')
  expect(verdict({ lane: 'skipped', required: 'false', changes: 'failure' })).toBe('red')
})

// A repository with a feature commit, its version commit, and a version commit that also changes a file.
const release_repository = (directory) => {
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid']
  const commit = (version, readme) => {
    writeFileSync(
      join(directory, 'package.json'),
      `{\n  "name": "aresrpg",\n  "version": "${version}",\n  "private": true\n}\n`
    )
    writeFileSync(join(directory, 'README.md'), readme)
    git('add', '.')
    git(...identity, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', version)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q')
  const feature = commit('1.0.0', 'one\n')
  const version = commit('1.0.1', 'one\n')
  const mixed = commit('1.0.2', 'two\n')
  // The release steps import the classifier by its checkout path.
  symlinkSync(resolve(ROOT, 'scripts'), join(directory, 'scripts'))
  return { feature, version, mixed }
}

test('a release certifies on the first green gate of its tree, never on a red gate or a different tree', () => {
  with_directory((directory) => {
    const { feature, version, mixed } = release_repository(directory)
    const release = workflow('release').jobs
    const certifiers = (sha) => {
      const output = join(directory, 'output')
      writeFileSync(output, '')
      const step = release['backend-plan'].steps.find(({ id }) => id === 'certifiers').run
      bash(step, { cwd: directory, env: { ...process.env, GITHUB_SHA: sha, GITHUB_OUTPUT: output } })
      return readFileSync(output, 'utf8').match(/^shas=(.*)$/m)[1]
    }
    const sets = { [version]: certifiers(version), [mixed]: certifiers(mixed) }
    const certified = (sha, states) => {
      const env = { ...process.env, CERTIFIERS: sets[sha], GITHUB_SHA: sha, GITHUB_REPOSITORY: 'owner/game' }
      return succeeds(() => bash(`${gate_states(states)}\n${release['verify-gate'].steps[0].run}`, { env }))
    }
    expect(sets).toEqual({ [version]: `${version} ${feature}`, [mixed]: mixed })
    // The identical parent turns green first, or the tag does, or the parent fails and the tag passes.
    expect(certified(version, { [feature]: 'success', [version]: 'running' })).toBe(true)
    expect(certified(version, { [feature]: 'running', [version]: 'success' })).toBe(true)
    expect(certified(version, { [feature]: 'failure', [version]: 'success' })).toBe(true)
    // A green parent whose tree differs outside the version line certifies nothing.
    expect(certified(mixed, { [version]: 'success', [mixed]: 'running' })).toBe(false)
    // Nothing green: two red gates, or a red gate and one that never concludes.
    expect(certified(version, { [feature]: 'failure', [version]: 'cancelled' })).toBe(false)
    expect(certified(version, { [feature]: 'failure', [version]: 'running' })).toBe(false)
  })
})
