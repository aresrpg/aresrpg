// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixture mutations can make a wrong fix hide its own evidence. These probes drive the real
// check-constraints row in disposable git repositories so the trailer verdict and PR-range
// boundary are tested together, including the explicit exemption for a newly added fixture.
import { execFileSync as exec_file_sync, spawnSync as spawn_sync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { afterEach, describe, expect, it } from 'bun:test'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(script_dir, '..')
const gate_path = path.join(script_dir, 'check-constraints.sh')
const fixtures = []

function fixture_repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-adjudication-'))
  fixtures.push(dir)
  const git = (...args) => exec_file_sync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '--quiet', '--initial-branch', 'edge', '.')
  git('config', 'user.name', 'Fixture Author')
  git('config', 'user.email', 'author@aresrpg.world')

  const fixture_path = path.join(dir, 'packages/sim/test/fixtures/replay/case.json')
  const golden_path = path.join(dir, 'packages/sim/test/vectors/case_golden.json')
  const root_golden_path = path.join(dir, 'test/gold/receipts/case.json')
  fs.mkdirSync(path.dirname(fixture_path), { recursive: true })
  fs.mkdirSync(path.dirname(golden_path), { recursive: true })
  fs.mkdirSync(path.dirname(root_golden_path), { recursive: true })
  fs.writeFileSync(fixture_path, '{"state":"seed"}\n')
  fs.writeFileSync(golden_path, '{"state":"seed"}\n')
  fs.writeFileSync(root_golden_path, '{"state":"seed"}\n')
  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--quiet', '--message', 'seed')
  const base = git('rev-parse', 'HEAD').trim()
  git('update-ref', 'refs/remotes/origin/edge', base)
  return { dir, git, base, fixture_path, golden_path, root_golden_path }
}

function commit_all(fixture, message) {
  fixture.git('add', '.')
  fixture.git('-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--quiet', '--message', message)
}

function run_gate(fixture) {
  const result = spawn_sync('bash', [gate_path, '--fixture-adjudication'], {
    cwd: repo_root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_DIR: path.join(fixture.dir, '.git'),
      GIT_WORK_TREE: fixture.dir,
    },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

afterEach(() => {
  while (fixtures.length > 0) fs.rmSync(fixtures.pop(), { recursive: true, force: true })
})

describe('fixture-adjudication constraint row', () => {
  it('judges an empty local range instead of crashing on an unset bash 3.2 array', () => {
    const fixture = fixture_repo()

    const { status, output } = run_gate(fixture)
    expect(status).toBe(0)
    expect(output).toContain('commits=0')
    expect(output).toContain('FIXTURE-ADJUDICATION GATE PASSED')
  })

  it('fails a fixture-mutating commit without an Adjudicated-by trailer', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"mutated"}\n')
    commit_all(fixture, 'test: mutate fixture')

    const { status, output } = run_gate(fixture)
    expect(status).toBe(1)
    expect(output).toContain('RED')
    expect(output).toContain('packages/sim/test/fixtures/replay/case.json')
    expect(output).toContain('wrong fix hide its own evidence')
  })

  it('passes a fixture-mutating commit adjudicated by a non-author', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"mutated"}\n')
    commit_all(fixture, 'test: mutate fixture\n\nAdjudicated-by: Evidence Reviewer <reviewer@aresrpg.world>')

    const { status, output } = run_gate(fixture)
    expect(status).toBe(0)
    expect(output).toContain('PASS')
    expect(output).toContain('Evidence Reviewer <reviewer@aresrpg.world>')
  })

  it('fails a fixture-mutating commit self-adjudicated by its author', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"mutated"}\n')
    commit_all(fixture, 'test: mutate fixture\n\nAdjudicated-by: Fixture Author <author@aresrpg.world>')

    const { status, output } = run_gate(fixture)
    expect(status).toBe(1)
    expect(output).toContain('RED')
    expect(output).toContain('self-adjudication')
  })

  it('does not let a later commit adjudicate an earlier mutation', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"mutated"}\n')
    commit_all(fixture, 'test: unadjudicated fixture mutation')
    fs.writeFileSync(path.join(fixture.dir, 'note.txt'), 'later\n')
    commit_all(fixture, 'docs: later review\n\nAdjudicated-by: Evidence Reviewer <reviewer@aresrpg.world>')

    const { status, output } = run_gate(fixture)
    expect(status).toBe(1)
    expect(output).toContain('RED')
    expect(output).toContain('test: unadjudicated fixture mutation')
    expect(output).toContain('commits=2')
  })

  it('exempts a new fixture once, then protects it and an existing golden JSON', () => {
    const fixture = fixture_repo()
    const new_fixture_path = path.join(fixture.dir, 'packages/fight/test/fixtures/new.json')
    fs.mkdirSync(path.dirname(new_fixture_path), { recursive: true })
    fs.writeFileSync(new_fixture_path, '{"state":"new"}\n')
    commit_all(fixture, 'test: add new fixture')

    let result = run_gate(fixture)
    expect(result.status).toBe(0)
    expect(result.output).toContain('new fixture addition(s) exempt')

    fs.writeFileSync(new_fixture_path, '{"state":"now-existing"}\n')
    fs.writeFileSync(fixture.golden_path, '{"state":"mutated"}\n')
    fs.writeFileSync(fixture.root_golden_path, '{"state":"mutated"}\n')
    commit_all(fixture, 'test: mutate fixtures\n\nAdjudicated-by: Evidence Reviewer <reviewer@aresrpg.world>')
    result = run_gate(fixture)
    expect(result.status).toBe(0)
    expect(result.output).toContain('packages/fight/test/fixtures/new.json')
    expect(result.output).toContain('packages/sim/test/vectors/case_golden.json')
    expect(result.output).toContain('test/gold/receipts/case.json')
  })
})
