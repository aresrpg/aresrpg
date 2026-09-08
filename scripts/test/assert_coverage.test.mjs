// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { coverage_census, coverage_totals, coverage_verdict, has_runtime } from '../assert_coverage.mjs'

const record = ({ lines_found, lines_hit, functions_found, functions_hit }) =>
  `TN:\nSF:file.ts\nFNF:${functions_found}\nFNH:${functions_hit}\nLF:${lines_found}\nLH:${lines_hit}\nend_of_record\n`

test('aggregates every LCOV record before applying the repository floor', () => {
  const totals = coverage_totals(
    record({ lines_found: 80, lines_hit: 40, functions_found: 10, functions_hit: 10 }) +
      record({ lines_found: 20, lines_hit: 20, functions_found: 10, functions_hit: 5 })
  )
  expect(totals).toEqual({ lines: 60, functions: 75 })
  expect(coverage_verdict(totals)).toEqual({ ok: true, failures: [] })
})

test('refuses either aggregate below its floor', () => {
  expect(coverage_verdict({ lines: 59.99, functions: 74.99 })).toEqual({
    ok: false,
    failures: ['lines 59.99% is below 60%', 'functions 74.99% is below 75%'],
  })
})

test('an empty or malformed report fails closed', () => {
  const totals = coverage_totals('LF:nope\nLH:0\n')
  expect(totals).toEqual({ lines: 0, functions: 0 })
  expect(coverage_verdict(totals).ok).toBeFalse()
})

test('the census retains unloaded effects and functions without executing either', () => {
  expect(has_runtime('throw new Error("must never execute")', 'worker.ts')).toBeTrue()
  expect(has_runtime('export const run = () => 1', 'run.ts')).toBeTrue()
  expect(has_runtime('import "./boot.ts"', 'entry.ts')).toBeTrue()
  expect(has_runtime('export interface Row { id: string }; export type Id = string', 'types.ts')).toBeFalse()
  expect(has_runtime('export declare const run: () => void', 'types.d.ts')).toBeFalse()
  expect(coverage_census('SF:loaded.ts\n', ['loaded.ts', 'worker.ts'])).toEqual({
    files: 2,
    missing: ['worker.ts'],
    loaded: 50,
  })
  expect(coverage_census('', []).loaded).toBe(0)
})
