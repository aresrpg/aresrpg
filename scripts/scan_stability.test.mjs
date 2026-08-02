// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2016 — a tree scan whose reading wobbles under CPU load is an instrument that answers before it
// measures. Measured on the arch gate: 144/140 findings on an UNCHANGED tree across two runs in the
// same window, while the rule's fixture self-test stayed stable — semgrep drops the findings of files
// it could not finish, so a `--write-baseline` that happens to land on an under-measured run bakes in
// a floor nobody can reproduce (and, worse, a floor the next honest run exceeds: the gate then reds on
// noise). The law: a count that feeds a BASELINE WRITE is max-of-3; a single-pass write is REFUSED.
//
// The scanner is mocked HERE — three canned semgrep payloads standing in for three consecutive runs of
// the same scan over the same tree, the middle one missing a whole file's findings (the exact dropout
// shape measured). The verdict scripts are driven as REAL subprocesses because the exit code and the
// bytes on disk are the entire law: a refusal that still writes the file is not a refusal.
import { spawnSync as spawn_sync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { afterEach, describe, expect, it } from 'bun:test'

import { MIN_STABILITY_RUNS, merge_stable_scan } from './arch/scan_stability.mjs'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(script_dir, '..')
const temps = []

const temp_dir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-stability-'))
  temps.push(dir)
  return dir
}

const finding = (check_id, file, line) => ({
  check_id,
  path: file,
  start: { line, col: 1 },
  end: { line, col: 40 },
  extra: { message: `${check_id} fired at ${file}:${line}` },
})

// The wobbly scanner: run 2 lost b.js entirely (its per-file budget ran out under load). A floor
// written from run 2 alone would claim b.js is clean forever.
const A = (rule) => finding(rule, 'packages/frontend/src/a.js', 10)
const B = (rule) => finding(rule, 'packages/frontend/src/a.js', 20)
const C = (rule) => finding(rule, 'packages/frontend/src/b.js', 5)
const wobbly_runs = (rule) => [
  [A(rule), B(rule), C(rule)],
  [A(rule), B(rule)],
  [A(rule), B(rule), C(rule)],
]

const write_scans = (dir, runs) =>
  runs.map((results, index) => {
    const file = path.join(dir, `run${index + 1}.json`)
    fs.writeFileSync(file, JSON.stringify({ results }))
    return file
  })

const run_verdict = (verdict, args) =>
  spawn_sync('node', [path.join(repo_root, 'scripts/arch', verdict), ...args], {
    cwd: repo_root,
    encoding: 'utf8',
  })

afterEach(() => {
  while (temps.length > 0) fs.rmSync(temps.pop(), { recursive: true, force: true })
})

describe('#2016 — baseline writes are max-of-3, never a single pass', () => {
  it('the mocked scanner really does wobble (positive control — an instrument that cannot fail proves nothing)', () => {
    const totals = wobbly_runs('arch.arch-fight-visible-source').map((results) => results.length)
    expect(new Set(totals).size).toBeGreaterThan(1)
    expect(Math.max(...totals)).toBe(3)
  })

  it('refuses a merge fed fewer than three runs, naming the shortfall', () => {
    const dir = temp_dir()
    const [one] = write_scans(dir, wobbly_runs('arch.arch-fight-visible-source').slice(0, 1))
    const refusal = merge_stable_scan([one])
    expect(refusal.ok).toBe(false)
    expect(refusal.error).toContain(String(MIN_STABILITY_RUNS))
  })

  it('takes the MAX across three runs and reports every run count', () => {
    const dir = temp_dir()
    const scans = write_scans(dir, wobbly_runs('arch.arch-fight-visible-source'))
    const merged = merge_stable_scan(scans)
    expect(merged.ok).toBe(true)
    expect(merged.per_run_totals).toEqual([3, 2, 3])
    expect(merged.unstable).toBe(true)
    expect(merged.scan.results.length).toBe(3)
  })

  it('semgrep_verdict --write-baseline REFUSES a single-run write and leaves the floor untouched', () => {
    const dir = temp_dir()
    const baseline = path.join(dir, 'baseline.json')
    fs.writeFileSync(baseline, '{}\n')
    const [one] = write_scans(dir, wobbly_runs('arch.arch-fight-visible-source').slice(1, 2))
    const result = run_verdict('semgrep_verdict.mjs', ['--write-baseline', baseline, one])
    expect(result.status).toBe(2)
    expect(`${result.stderr}`).toContain('#2016')
    expect(fs.readFileSync(baseline, 'utf8')).toBe('{}\n')
  })

  it('semgrep_verdict --write-baseline writes the MAX of three runs, not the run it was handed last', () => {
    const dir = temp_dir()
    const baseline = path.join(dir, 'baseline.json')
    const scans = write_scans(dir, wobbly_runs('arch.arch-fight-visible-source'))
    const result = run_verdict('semgrep_verdict.mjs', ['--write-baseline', baseline, ...scans])
    expect(result.status).toBe(0)
    expect(JSON.parse(fs.readFileSync(baseline, 'utf8'))).toEqual({
      'arch-fight-visible-source': {
        'packages/frontend/src/a.js': 2,
        'packages/frontend/src/b.js': 1,
      },
    })
    // the wobble is never silent: the operator reading the write sees which runs disagreed
    expect(`${result.stdout}`).toContain('3, 2, 3')
  })

  it('a comparison-only run stays single-pass (the fast path is unchanged)', () => {
    const dir = temp_dir()
    const baseline = path.join(dir, 'baseline.json')
    fs.writeFileSync(
      baseline,
      `${JSON.stringify({
        'arch-fight-visible-source': { 'packages/frontend/src/a.js': 2, 'packages/frontend/src/b.js': 1 },
      })}\n`
    )
    const [one] = write_scans(dir, wobbly_runs('arch.arch-fight-visible-source').slice(0, 1))
    const result = run_verdict('semgrep_verdict.mjs', ['--baseline', baseline, one])
    expect(result.status).toBe(0)
    expect(`${result.stdout}`).toContain('ratchet')
  })

  // The class, not the instance: every semgrep-driven baseline writer in the tree carries the same
  // dropout failure mode, so every one of them refuses a single-pass write.
  it.each([
    ['sim_constants_verdict.mjs', 'sim.sim-protocol-constant-redeclared'],
    ['entropy_before_validation_verdict.mjs', 'move.move-entropy-before-validation'],
  ])('%s --write-baseline refuses a single-run write', (verdict, rule) => {
    const dir = temp_dir()
    const baseline = path.join(dir, 'baseline.json')
    fs.writeFileSync(baseline, '{}\n')
    const [one] = write_scans(dir, wobbly_runs(rule).slice(1, 2))
    const result = run_verdict(verdict, ['--write-baseline', baseline, one])
    expect(result.status).toBe(2)
    expect(`${result.stderr}`).toContain('#2016')
    expect(fs.readFileSync(baseline, 'utf8')).toBe('{}\n')
  })
})
