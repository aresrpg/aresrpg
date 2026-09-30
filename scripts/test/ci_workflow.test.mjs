// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { expect, test } from 'bun:test'

const workflow = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
const { jobs } = workflow

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
