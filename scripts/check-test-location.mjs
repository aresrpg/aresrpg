#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// L-L1 — tests live in test/; src/ is source only. Engine and frontend carry measured debt,
// pinned one exact path per row in scripts/arch/in_src_tests.baseline.txt. The baseline is the
// tree, exactly: a fresh *.test.* / *.spec.* under any src/ is red, and a row whose file is gone
// is red too, so scripts/relocate-tests.mjs and the baseline move in the same commit. MAX_IN_SRC_TESTS
// below is the ceiling's ONE home — the only number that can let the debt grow, and it only shrinks.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const repo_root = path.resolve(path.dirname(script_path), '..')
const baseline_path = path.join(repo_root, 'scripts/arch/in_src_tests.baseline.txt')
const MAX_IN_SRC_TESTS = 515
const ignored_directories = new Set(['.git', '.agents', '.codex', 'build', 'dist', 'node_modules', 'target'])
const test_file = /\.(?:test|spec)\.[^/]+$/

const relative_path = (root, file) => path.relative(root, file).split(path.sep).join('/')

export const in_src_tests = (root) => {
  const files = []
  const walk = (directory, below_src = false) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored_directories.has(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(file, below_src || entry.name === 'src')
        continue
      }
      if (below_src && entry.isFile() && test_file.test(entry.name) && !entry.name.endsWith('.snap'))
        files.push(relative_path(root, file))
    }
  }
  walk(root)
  return files.sort()
}

const baseline_rows = (source) =>
  source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

export const evaluate_test_location = (current, baseline, ceiling = MAX_IN_SRC_TESTS) => {
  const current_set = new Set(current)
  const baseline_set = new Set(baseline)
  return {
    baseline_growth: Math.max(0, baseline.length - ceiling),
    duplicate_baseline: baseline.filter((file, index) => baseline.indexOf(file) !== index),
    new_tests: current.filter((file) => !baseline_set.has(file)),
    retired_tests: baseline.filter((file) => !current_set.has(file)),
    unsorted_baseline: baseline.some((file, index) => index > 0 && baseline[index - 1] > file),
  }
}

const failure_lines = (verdict) => {
  const failures = []
  if (verdict.baseline_growth)
    failures.push(`the in-src baseline grew by ${verdict.baseline_growth} row(s); FROZEN baselines only shrink`)
  if (verdict.duplicate_baseline.length)
    failures.push(`duplicate baseline row(s): ${[...new Set(verdict.duplicate_baseline)].join(', ')}`)
  if (verdict.unsorted_baseline) failures.push('the in-src baseline is not sorted')
  if (verdict.new_tests.length) {
    failures.push('new test file(s) under src/:')
    failures.push(...verdict.new_tests.map((file) => `  ${file}`))
    failures.push('move them with scripts/relocate-tests.mjs')
  }
  if (verdict.retired_tests.length) {
    failures.push('baseline row(s) whose file is gone — the ceiling must follow the tree down:')
    failures.push(...verdict.retired_tests.map((file) => `  ${file}`))
    failures.push(
      'drop them from scripts/arch/in_src_tests.baseline.txt in the same commit, and lower MAX_IN_SRC_TESTS to match'
    )
  }
  return failures
}

const prove_synthetic_red = () => {
  const control_root = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-l-l1-control-'))
  const fresh_test = path.join(control_root, 'packages/control/src/fresh.test.js')
  try {
    fs.mkdirSync(path.dirname(fresh_test), { recursive: true })
    fs.writeFileSync(fresh_test, "import { test } from 'bun:test'\n")
    const current = in_src_tests(control_root)
    const verdict = evaluate_test_location(current, [], 0)
    const [new_test] = verdict.new_tests
    const output = failure_lines(verdict).join('\n')
    if (
      verdict.new_tests.length !== 1 ||
      new_test !== 'packages/control/src/fresh.test.js' ||
      !output.includes('scripts/relocate-tests.mjs')
    )
      throw new Error('synthetic new in-src test did not trip the gate with the relocation cure')
  } finally {
    fs.rmSync(control_root, { recursive: true, force: true })
  }
  console.log('L-L1 proof red: synthetic packages/control/src/fresh.test.js rejected; cure named')
}

const prove_baseline_refuses_growth = (current, baseline) => {
  const fresh_test = 'packages/control/src/fresh.test.js'
  const verdict = evaluate_test_location([...current, fresh_test].sort(), [...baseline, fresh_test].sort())
  if (verdict.baseline_growth !== 1 || failure_lines(verdict).length === 0)
    throw new Error('a synthetic baseline addition did not trip the shrink-only ceiling')
  console.log(`L-L1 proof ratchet: ${baseline.length + 1}-row synthetic baseline rejected above ${baseline.length}`)
}

const prove_retired_row_refused = () => {
  const relocated = 'packages/control/src/gone.test.js'
  const verdict = evaluate_test_location([], [relocated], 1)
  const output = failure_lines(verdict).join('\n')
  if (verdict.retired_tests.length !== 1 || !output.includes(relocated) || !output.includes('MAX_IN_SRC_TESTS'))
    throw new Error('a baseline row with no file on disk did not trip the follow-the-tree-down tooth')
  console.log('L-L1 proof stale: a baseline row whose file is gone rejected; ceiling must follow')
}

try {
  prove_synthetic_red()
  prove_retired_row_refused()
  const baseline = baseline_rows(fs.readFileSync(baseline_path, 'utf8'))
  const current = in_src_tests(repo_root)
  const verdict = evaluate_test_location(current, baseline)
  const failures = failure_lines(verdict)
  if (failures.length) {
    console.error('L-L1 TEST LOCATION GATE FAILED')
    failures.forEach((failure) => console.error(`  ${failure}`))
    process.exit(1)
  }
  console.log(`L-L1 proof green: current tree has no tests above the ${baseline.length}-row exact-path baseline`)
  prove_baseline_refuses_growth(current, baseline)
  const package_counts = current.reduce((counts, file) => {
    const [, package_name] = file.split('/')
    counts.set(package_name, (counts.get(package_name) ?? 0) + 1)
    return counts
  }, new Map())
  const census = [...package_counts].map(([name, count]) => `${name}=${count}`).join(' ')
  console.log(`L-L1 TEST LOCATION GATE PASSED: ${current.length} measured debt rows (${census}); baseline only shrinks`)
} catch (error) {
  console.error(`L-L1 TEST LOCATION GATE FAILED: ${error.message}`)
  process.exit(1)
}
