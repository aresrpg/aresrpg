// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { expect, test } from 'bun:test'

const workflow = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
const { jobs } = workflow

test('indexer coverage discovers the package compiler configuration', () => {
  const bin = mkdtempSync(join(tmpdir(), 'ares-cargo-cwd-'))
  try {
    writeFileSync(
      join(bin, 'cargo'),
      '#!/bin/sh\nif [ "$*" = "llvm-cov --version" ]; then echo "cargo-llvm-cov 0.9.0"; else pwd; fi\n',
      { mode: 0o755 }
    )
    writeFileSync(join(bin, 'rustup'), '#!/bin/sh\necho llvm-tools\n', { mode: 0o755 })
    const output = execFileSync('sh', [resolve(import.meta.dirname, '../coverage_indexer.sh')], {
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    })
    expect(output.trim()).toBe(resolve(import.meta.dirname, '../../packages/indexer'))
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the Move sparse checkout includes the coverage checker it executes', () => {
  const checkout = jobs.tests_move.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  expect(checkout.with['sparse-checkout'].trim().split('\n')).toContain('scripts/assert_rewards_coverage.mjs')
})

test('verification selector executes with only its sparse checkout files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-ci-inputs-'))
  try {
    const checkout = jobs.changes.steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
    for (const path of checkout.with['sparse-checkout'].trim().split('\n')) {
      const destination = join(directory, path)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(new URL(`../../${path}`, import.meta.url), destination, { recursive: true })
    }
    const output = join(directory, 'outputs')
    execFileSync('node', ['scripts/ci_inputs.mjs'], {
      cwd: directory,
      env: { ...process.env, BASE_SHA: '', GITHUB_OUTPUT: output },
      stdio: 'pipe',
    })
    expect(readFileSync(output, 'utf8')).toBe('browsers=true\nmove=true\nindexer=true\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('all selective lanes use a successful edge push baseline, including PRs', () => {
  const step = jobs.changes.steps.find(({ id }) => id === 'inputs')
  expect(step.env.BASE_SHA).toBeUndefined()
  expect(step.run).toContain('--branch edge --event push --status success')
  expect(step.run).toContain('node scripts/ci_inputs.mjs')
  for (const [job, output] of [
    ['tests_move', 'move'],
    ['tests_indexer', 'indexer'],
    ['browsers', 'browsers'],
  ]) {
    expect(jobs[job].needs).toBe('changes')
    expect(jobs[job].if).toBe(`needs.changes.outputs.${output} == 'true'`)
    expect(jobs.changes.outputs[output]).toBe(`\${{ steps.inputs.outputs.${output} }}`)
  }
})

const check_gate = (lane, result, required) => {
  const fields = {
    'needs.changes.result': 'success',
    'needs.source.result': 'success',
    'needs.tests_move.result': 'success',
    'needs.tests_indexer.result': 'success',
    'needs.browsers.result': 'success',
    'needs.changes.outputs.move': 'true',
    'needs.changes.outputs.indexer': 'true',
    'needs.changes.outputs.browsers': 'true',
    "github.event_name == 'push' || needs.bundle-gate.result == 'success'": 'true',
    [`needs.${lane}.result`]: result,
    [`needs.changes.outputs.${{ tests_move: 'move', tests_indexer: 'indexer', browsers: 'browsers' }[lane]}`]: required,
  }
  const run = jobs.gate.steps[0].run.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    if (!(key in fields)) throw new Error(`Unexpected expression ${key}`)
    return fields[key]
  })
  return () => execFileSync('/bin/bash', ['-e', '-c', run], { stdio: 'pipe' })
}

for (const lane of ['tests_move', 'tests_indexer', 'browsers'])
  test(`${lane} skips only with explicit unchanged-input evidence`, () => {
    check_gate(lane, 'success', 'true')()
    check_gate(lane, 'skipped', 'false')()
    for (const result of ['failure', 'cancelled', 'skipped', '']) expect(check_gate(lane, result, 'true')).toThrow()
    for (const result of ['failure', 'cancelled', '']) expect(check_gate(lane, result, 'false')).toThrow()
    expect(check_gate(lane, 'skipped', '')).toThrow()
  })

test('failed or missing source verification cannot certify a release', () => {
  check_gate('source', 'success', 'true')()
  for (const result of ['failure', 'cancelled', 'skipped', '']) expect(check_gate('source', result, 'true')).toThrow()
})

test('indexer parity checkout includes the shared leaderboard vocabulary', () => {
  const checkout = jobs.tests_indexer.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  const paths = checkout.with['sparse-checkout'].trim().split('\n')
  expect(paths).toContain('packages/protocol')
  expect(paths).toContain('packages/immutable')
})
