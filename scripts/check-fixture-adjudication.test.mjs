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

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test'

// Every probe here spawns real git repos and real gate subprocesses: 1.6–3.9s each on an idle dev
// Mac, and the heaviest drives the gate TWICE. Against bun's 5s default that is not a margin, it is a
// coin flip — under load the second gate run gets killed mid-flight and spawnSync reports `status:
// null`, which reads as a gate verdict of "failed" when nothing was ever judged. Same disease #641
// fixed in the engine suite; wiring this suite into CI (#2020) is what made the flake CI's problem.
setDefaultTimeout(60_000)

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

function run_gate(fixture, refs = null) {
  const event_path = path.join(fixture.dir, 'event.json')
  if (refs !== null) {
    fs.writeFileSync(
      event_path,
      JSON.stringify({
        pull_request: {
          base: { sha: fixture.base, ref: refs.base, repo: { full_name: 'Sceat/aresrpg' } },
          head: {
            sha: fixture.git('rev-parse', 'HEAD').trim(),
            ref: refs.head,
            repo: { full_name: refs.head_repo ?? 'Sceat/aresrpg' },
          },
        },
      })
    )
  }
  const result = spawn_sync('bash', [gate_path, '--fixture-adjudication'], {
    cwd: repo_root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_DIR: path.join(fixture.dir, '.git'),
      GIT_WORK_TREE: fixture.dir,
      ...(refs === null
        ? {
            GITHUB_EVENT_NAME: '',
            GITHUB_EVENT_PATH: '',
            GITHUB_ACTIONS: '',
            CI: '',
          }
        : {
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_EVENT_PATH: event_path,
          }),
    },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function print_evidence(label, result) {
  if (process.env.PROMOTION_GATE_EVIDENCE === '1')
    console.log(`--- ${label} (exit ${result.status}) ---\n${result.output}`)
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

  it('passes promotion history while the same commit still reds on a normal PR', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"historical-unadjudicated-mutation"}\n')
    commit_all(fixture, 'test: historical fixture mutation')

    const normal = run_gate(fixture, { base: 'edge', head: 'topic' })
    print_evidence('fixture normal PR negative control', normal)
    expect(normal.status).toBe(1)
    expect(normal.output).toContain('test: historical fixture mutation')
    expect(normal.output).toContain('red=1')

    const promotion = run_gate(fixture, { base: 'master', head: 'edge' })
    print_evidence('fixture promotion control', promotion)
    expect(promotion.status).toBe(0)
    expect(promotion.output).toContain(
      'promotion range: 1 commits already adjudicated on edge entry — pass-with-reason'
    )
  })

  it('does not mistake a fork branch named edge for the integration branch', () => {
    const fixture = fixture_repo()
    fs.writeFileSync(fixture.fixture_path, '{"state":"fork-mutation"}\n')
    commit_all(fixture, 'test: fork fixture mutation')

    const fork = run_gate(fixture, { base: 'master', head: 'edge', head_repo: 'fork/aresrpg' })

    expect(fork.status).toBe(1)
    expect(fork.output).toContain('test: fork fixture mutation')
    expect(fork.output).not.toContain('pass-with-reason')
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
