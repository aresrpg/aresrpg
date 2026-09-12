// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const workflow = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/gate.yml', import.meta.url), 'utf8'))
const { jobs } = workflow

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

test('browser matrix shards every existing platform and retains independent reports', () => {
  const job = jobs.browsers
  expect(job.strategy.matrix.target).toEqual([
    { os: 'ubuntu-latest', browser: 'chrome' },
    { os: 'ubuntu-latest', browser: 'firefox' },
    { os: 'macos-latest', browser: 'chrome' },
  ])
  expect(job.strategy.matrix.suite).toEqual([
    { project: 'ui', shard: '1/1' },
    { project: 'workloads', shard: '1/3' },
    { project: 'workloads', shard: '2/3' },
    { project: 'workloads', shard: '3/3' },
  ])
  expect(job.strategy['fail-fast']).toBe(false)
  const { run } = job.steps.find(({ name }) => name === 'browser compatibility tests')
  expect(run.match(/--project=\$\{\{ matrix.suite.project \}\} --shard=\$\{\{ matrix.suite.shard \}\}/g)).toHaveLength(
    2
  )
  expect(job.steps.at(-1).with.name).toContain('${{ strategy.job-index }}')
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

const listed_specs = (suites) =>
  suites.flatMap((suite) => [...(suite.specs ?? []), ...listed_specs(suite.suites ?? [])])

for (const browser of ['chrome', 'firefox'])
  test(`${browser} CI lanes cover every test once and distribute world workloads`, () => {
    const list = (args) =>
      listed_specs(
        JSON.parse(
          execFileSync(
            process.execPath,
            [
              'node_modules/@playwright/test/cli.js',
              'test',
              '--config',
              'packages/frontend/e2e/playwright.config.ts',
              '--list',
              '--reporter=json',
              ...args,
            ],
            { encoding: 'utf8', env: { ...process.env, BROWSER: browser } }
          )
        ).suites
      )
    const all = list([])
      .map(({ id }) => id)
      .toSorted()
    const lanes = jobs.browsers.strategy.matrix.suite.map(({ project, shard }) =>
      list([`--project=${project}`, `--shard=${shard}`])
    )
    const ids = lanes.flat().map(({ id }) => id)
    expect(ids.toSorted()).toEqual(all)
    expect(new Set(ids).size).toBe(ids.length)
    const workloads = lanes.slice(1)
    expect(workloads.every((lane) => lane.length > 0)).toBe(true)
    expect(
      Math.max(...workloads.map((lane) => lane.length)) - Math.min(...workloads.map((lane) => lane.length))
    ).toBeLessThanOrEqual(1)
  }, 15_000)
