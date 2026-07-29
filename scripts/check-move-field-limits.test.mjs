// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The no-verdict severity split (#938). The gate is loud by design — a silent skip once hid a real 32/32
// hit — but "nothing was judged" on a checkout whose diff PROVABLY holds no Move source change is a
// different fact from "nothing was judged" while a .move file moved under it. The first warns and exits 0
// naming the missing toolchain and its diff base; the second, a CI run, and an unreadable diff base all
// keep the hard red.
//
// These probes drive the REAL script in a real subprocess and assert its exit code, because the exit code
// is the whole bug: a red that fires on every fresh worktree trains contributors to ignore the colour.
// The diff base is supplied by a disposable git repo through GIT_DIR/GIT_WORK_TREE, so the quadrants are
// decided by the fixture and not by whatever this checkout's branch, remotes, or fetch depth happen to be
// (a CI checkout is shallow and has no origin/edge — the assertions must not depend on that).
import { execFileSync as exec_file_sync, spawnSync as spawn_sync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { afterEach, describe, expect, it } from 'bun:test'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(script_dir, '..')
const gate_path = path.join(script_dir, 'check-move-field-limits.mjs')
const fixtures = []

// A one-commit repo standing in for the contributor's checkout. `with_origin_edge` mints the
// refs/remotes/origin/edge the gate resolves its diff base against; without it the base is unknowable.
function fixture_repo({ with_origin_edge }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-cap-fixture-'))
  fixtures.push(dir)
  const git = (...args) => exec_file_sync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '--quiet', '--initial-branch', 'edge', '.')
  git('config', 'user.email', 'gate@aresrpg.world')
  git('config', 'user.name', 'field-cap fixture')
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--quiet', '--message', 'seed')
  const head = git('rev-parse', 'HEAD').trim()
  if (with_origin_edge) git('update-ref', 'refs/remotes/origin/edge', head)
  return { dir, head }
}

// The fresh-worktree condition #938 reports: no sui anywhere on PATH.
function path_without_sui() {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((entry) => entry && !fs.existsSync(path.join(entry, 'sui')))
    .join(path.delimiter)
}

function run_gate(fixture, overrides = {}) {
  const env = {
    ...process.env,
    PATH: path_without_sui(),
    GIT_DIR: path.join(fixture.dir, '.git'),
    GIT_WORK_TREE: fixture.dir,
  }
  delete env.CI
  const result = spawn_sync(process.execPath, [gate_path], {
    cwd: repo_root,
    encoding: 'utf8',
    env: { ...env, ...overrides },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function unbuilt_gate_fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'field-cap-unbuilt-'))
  fixtures.push(dir)
  const fixture_script_dir = path.join(dir, 'scripts')
  const package_dir = path.join(dir, 'packages', 'move', 'probe')
  const source_dir = path.join(package_dir, 'sources')
  const bin_dir = path.join(dir, 'bin')
  const call_log = path.join(dir, 'sui-calls.log')
  fs.mkdirSync(fixture_script_dir, { recursive: true })
  fs.mkdirSync(source_dir, { recursive: true })
  fs.mkdirSync(bin_dir, { recursive: true })
  fs.copyFileSync(gate_path, path.join(fixture_script_dir, 'check-move-field-limits.mjs'))
  fs.writeFileSync(path.join(package_dir, 'Move.toml'), '[package]\nname = "probe"\n')
  fs.writeFileSync(
    path.join(source_dir, 'probe.move'),
    'module probe::probe { public struct WithinCap { value: u64 } }\n'
  )
  const fake_sui = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.SUI_CALL_LOG, args.join(' ') + '\\n')
if (args[0] === '--version') {
  console.log('sui 1.0.0-test')
  process.exit(0)
}
const path_index = args.indexOf('--path')
const package_dir = path.resolve(process.cwd(), args[path_index + 1])
const move_toml = fs.readFileSync(path.join(package_dir, 'Move.toml'), 'utf8')
const package_name = move_toml.match(/^name\\s*=\\s*"([^"]+)"/m)[1]
const build_dir = path.join(package_dir, 'build', package_name)
const built_sources = path.join(build_dir, 'sources')
const bytecode_dir = path.join(build_dir, 'bytecode_modules')
fs.mkdirSync(built_sources, { recursive: true })
fs.mkdirSync(bytecode_dir, { recursive: true })
for (const file_name of fs.readdirSync(path.join(package_dir, 'sources'))) {
  const source = fs.readFileSync(path.join(package_dir, 'sources', file_name), 'utf8')
  fs.writeFileSync(path.join(built_sources, file_name), source)
  const local_module = source.match(/module\\s+[^:]+::([A-Za-z0-9_]+)/)[1]
  fs.writeFileSync(path.join(bytecode_dir, local_module + '.mv'), 'compiled')
}
fs.writeFileSync(path.join(build_dir, 'BuildInfo.yaml'), 'compiled: true\\n')
`
  const fake_sui_path = path.join(bin_dir, 'sui')
  fs.writeFileSync(fake_sui_path, fake_sui, { mode: 0o755 })
  return {
    call_log,
    gate_path: path.join(fixture_script_dir, 'check-move-field-limits.mjs'),
    path: `${bin_dir}${path.delimiter}${process.env.PATH ?? ''}`,
  }
}

afterEach(() => {
  while (fixtures.length > 0) fs.rmSync(fixtures.pop(), { recursive: true, force: true })
})

describe('field-cap gate — fresh checkout with the toolchain', () => {
  it('builds each missing package once, then renders the field-cap verdict', () => {
    const fixture = unbuilt_gate_fixture()
    const options = {
      encoding: 'utf8',
      env: { ...process.env, PATH: fixture.path, SUI_CALL_LOG: fixture.call_log },
    }
    const result = spawn_sync(process.execPath, [fixture.gate_path], options)
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.status).toBe(0)
    expect(output).toContain('1 structs checked')
    expect(output).not.toContain('nothing was judged')

    const warm_result = spawn_sync(process.execPath, [fixture.gate_path], options)
    expect(warm_result.status).toBe(0)
    expect(fs.readFileSync(fixture.call_log, 'utf8').split('\n')).toEqual([
      '--version',
      'move build --path packages/move/probe',
      '--version',
      '',
    ])
  })
})

describe('field-cap gate — no toolchain, no Move delta', () => {
  it('warns naming the missing toolchain and the base it judged, and exits 0', () => {
    const fixture = fixture_repo({ with_origin_edge: true })
    const { status, output } = run_gate(fixture)
    expect(output).toContain('sui CLI absent/unusable')
    expect(output).toContain('NO VERDICT (WARN)')
    expect(output).toContain(`no .move file differs from merge-base ${fixture.head} (origin/edge)`)
    expect(output).not.toContain('MOVE FIELD-CAP GATE FAILED')
    expect(status).toBe(0)
  })
})

describe('field-cap gate — every other no-verdict state stays red', () => {
  it('fails closed on a .move delta the toolchain cannot judge', () => {
    const fixture = fixture_repo({ with_origin_edge: true })
    fs.writeFileSync(path.join(fixture.dir, 'kolizeum.move'), 'module probe::probe;\n')
    const { status, output } = run_gate(fixture)
    expect(output).toContain('MOVE FIELD-CAP GATE FAILED')
    expect(output).toContain('1 .move file(s) differ from merge-base')
    expect(output).toContain('kolizeum.move')
    expect(status).toBe(1)
  })

  it('fails closed under CI even with no Move delta', () => {
    const fixture = fixture_repo({ with_origin_edge: true })
    const { status, output } = run_gate(fixture, { CI: '1' })
    expect(output).toContain('MOVE FIELD-CAP GATE FAILED')
    expect(output).toContain('CI is set')
    expect(status).toBe(1)
  })

  it('fails closed when no origin/edge is reachable to state a diff base', () => {
    const fixture = fixture_repo({ with_origin_edge: false })
    const { status, output } = run_gate(fixture)
    expect(output).toContain('MOVE FIELD-CAP GATE FAILED')
    expect(output).toContain('the Move delta is unknown')
    expect(status).toBe(1)
  })
})
