// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The complexity gate must distinguish an inherited score from a regression, reduction, or new hard breach.

import { describe, expect, it, test } from 'bun:test'
import { RuleTester } from 'eslint'
import sonarjs from 'eslint-plugin-sonarjs'

import { create_complexity_gate, unsafe_baseline_change } from './complexity_gate.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = (...args) => it.only(...args)

const REPO_ROOT = '/repo'
const FILENAME = '/repo/src/example.js'
const branches = (count) =>
  `const task = (value) => { ${Array.from({ length: count }, (_, index) => `if (value === ${index}) return ${index};`).join(' ')} return -1 }`
const baseline = (metric, score) => ({
  version: 1,
  cognitive: {},
  cyclomatic: {},
  [metric]: { 'src/example.js': { task: [score] } },
})
const rule = (metric, score) =>
  create_complexity_gate({ sonarjs, baseline: baseline(metric, score), repo_root: REPO_ROOT }).rules[metric]
const empty_rule = (metric) =>
  create_complexity_gate({ sonarjs, baseline: { version: 1, cognitive: {}, cyclomatic: {} }, repo_root: REPO_ROOT })
    .rules[metric]
const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } })

tester.run('cyclomatic exact-score baseline', rule('cyclomatic', 9), {
  valid: [{ filename: FILENAME, code: branches(8) }],
  invalid: [
    { filename: FILENAME, code: branches(9), errors: [{ messageId: 'regression' }] },
    { filename: FILENAME, code: branches(7), errors: [{ messageId: 'stale' }] },
  ],
})

tester.run('cyclomatic hard ceiling', empty_rule('cyclomatic'), {
  valid: [{ filename: FILENAME, code: branches(7) }],
  invalid: [
    { filename: FILENAME, code: branches(8), errors: [{ messageId: 'baselineMissing' }] },
    { filename: FILENAME, code: branches(12), errors: [{ messageId: 'hardCeiling' }] },
  ],
})

tester.run('cognitive exact-score baseline', rule('cognitive', 11), {
  valid: [{ filename: FILENAME, code: branches(11), options: [10] }],
  invalid: [
    { filename: FILENAME, code: branches(12), options: [10], errors: [{ messageId: 'regression' }] },
    { filename: FILENAME, code: branches(10), options: [10], errors: [{ messageId: 'stale' }] },
  ],
})

tester.run('cognitive hard ceiling', empty_rule('cognitive'), {
  valid: [{ filename: FILENAME, code: branches(10), options: [10] }],
  invalid: [{ filename: FILENAME, code: branches(16), options: [10], errors: [{ messageId: 'hardCeiling' }] }],
})

test('baseline updates accept reviewed soft hotspots but refuse regressions and new hard breaches', () => {
  expect(unsafe_baseline_change('cyclomatic', [], [9])).toBeNull()
  expect(unsafe_baseline_change('cyclomatic', [], [13])).toBe('hardCeiling')
  expect(unsafe_baseline_change('cyclomatic', [9], [10])).toBe('regression')
  expect(unsafe_baseline_change('cyclomatic', [9], [8])).toBeNull()
})
