// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { beforeAll, expect, test } from 'bun:test'

import browser_config from '../../packages/frontend/e2e/playwright.config.ts'

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
  expect(job['timeout-minutes']).toBe(5)
  const targets = new Set(job.strategy.matrix.include.map(({ os, browser }) => `${os}/${browser}`))
  expect([...targets]).toEqual(['ubuntu-latest/chrome', 'ubuntu-latest/firefox', 'macos-latest/chrome'])
  const mac = job.strategy.matrix.include.filter(({ os }) => os === 'macos-latest')
  expect(mac).toHaveLength(5)
  expect(mac.filter(({ project }) => project === 'ui').map(({ shard }) => shard)).toEqual(['1/2', '2/2'])
  expect(job.strategy['fail-fast']).toBe(false)
  expect(job.steps.find(({ name }) => name === 'prepare browser').run).toBe('bun scripts/prepare_browser.mjs')
  const { run, env } = job.steps.find(({ name }) => name === 'browser compatibility tests')
  expect(env?.BROWSER_WORKERS).toBe("${{ matrix.project == 'ui' && 2 || 1 }}")
  expect(run.match(/--workers="\$BROWSER_WORKERS"/g)).toHaveLength(2)
  expect(run.match(/--project=\$\{\{ matrix.project \}\} --shard=\$\{\{ matrix.shard \}\}/g)).toHaveLength(2)
  expect(job.steps.at(-1).with.name).toContain('${{ strategy.job-index }}')
})

test('UI waits retain short budgets and local runs default to one worker', () => {
  const ui = browser_config.projects.find(({ name }) => name === 'ui')
  expect(browser_config.workers).toBe(1)
  expect(browser_config.retries).toBe(0)
  expect(browser_config.expect.toPass.timeout).toBe(3_000)
  expect(ui.fullyParallel).toBe(true)
  expect(ui.timeout).toBe(60_000)
  expect(ui.use.actionTimeout).toBe(10_000)
  expect(ui.use.navigationTimeout).toBe(20_000)
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

const catalogs = new Map()
beforeAll(() => {
  for (const browser of ['chrome', 'firefox']) {
    const report = execFileSync(
      process.execPath,
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        'packages/frontend/e2e/playwright.config.ts',
        '--list',
        '--reporter=json',
      ],
      { encoding: 'utf8', env: { ...process.env, BROWSER: browser } }
    )
    catalogs.set(browser, listed_specs(JSON.parse(report).suites))
  }
})

for (const [os, browser] of [
  ['ubuntu-latest', 'chrome'],
  ['ubuntu-latest', 'firefox'],
  ['macos-latest', 'chrome'],
])
  test(`${os}/${browser} has a complete shard partition for every discovered project`, () => {
    const specs = catalogs.get(browser)
    const projects = [...new Set(specs.flatMap((spec) => spec.tests.map((test) => test.projectName)))]
    const plans = jobs.browsers.strategy.matrix.include.filter((row) => row.os === os && row.browser === browser)
    expect([...new Set(plans.map(({ project }) => project))].toSorted()).toEqual(projects.toSorted())
    for (const project of projects) {
      const shards = plans.filter((row) => row.project === project).map(({ shard }) => shard.split('/').map(Number))
      const count = shards.length
      expect(shards.map(([, total]) => total)).toEqual(Array(count).fill(count))
      expect(shards.map(([index]) => index).toSorted((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, i) => i + 1)
      )
      const selected = specs.filter((spec) => spec.tests.some((test) => test.projectName === project))
      expect(selected.length).toBeGreaterThanOrEqual(count)
      if (project.startsWith('workloads-'))
        expect(selected.filter(({ title }) => title.startsWith('city /'))).toHaveLength(1)
    }
  })

test('source checks run independently and the final gate requires the whole matrix', () => {
  expect(jobs.source.strategy['fail-fast']).toBe(false)
  expect(jobs.source.strategy.matrix.check).toEqual([
    { name: 'lint', command: 'bunx eslint . --max-warnings 0' },
    { name: 'format', command: 'bunx prettier . --check' },
    { name: 'types', command: 'bun run typecheck' },
    { name: 'tests', command: 'bun run test' },
  ])
  expect(jobs.source.steps.at(-1).run).toBe('${{ matrix.check.command }}')
  expect(jobs.gate.needs).toContain('source')
  check_gate('source', 'success', 'true')()
  for (const result of ['failure', 'cancelled', 'skipped']) expect(check_gate('source', result, 'true')).toThrow()
})
