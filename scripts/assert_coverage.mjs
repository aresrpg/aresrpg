// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Bun's native threshold is per file. This gate retains every loaded handwritten file and checks
// the repository-wide LCOV distribution instead of manufacturing a giant low-coverage ignore list.

import fs from 'node:fs'

export const COVERAGE_FLOOR = Object.freeze({ lines: 60, functions: 75 })

const total_field = (lcov, prefix) =>
  lcov
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .reduce((sum, line) => sum + Number(line.slice(prefix.length)), 0)

const percentage = (hit, found) =>
  found > 0 && Number.isFinite(hit) && Number.isFinite(found) && hit >= 0 && hit <= found ? (hit / found) * 100 : 0

export const coverage_totals = (lcov) => {
  const lines_found = total_field(lcov, 'LF:')
  const lines_hit = total_field(lcov, 'LH:')
  const functions_found = total_field(lcov, 'FNF:')
  const functions_hit = total_field(lcov, 'FNH:')
  return Object.freeze({
    lines: percentage(lines_hit, lines_found),
    functions: percentage(functions_hit, functions_found),
  })
}

export const coverage_verdict = (totals, floor = COVERAGE_FLOOR) => {
  const failures = Object.entries(floor)
    .filter(([metric, minimum]) => !Number.isFinite(totals[metric]) || totals[metric] < minimum)
    .map(([metric, minimum]) => `${metric} ${totals[metric].toFixed(2)}% is below ${minimum}%`)
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) })
}

if (import.meta.main) {
  const [, , path] = process.argv
  if (!path) throw new Error('usage: bun scripts/assert_coverage.mjs <lcov.info>')
  const totals = coverage_totals(fs.readFileSync(path, 'utf8'))
  const verdict = coverage_verdict(totals)
  process.stdout.write(`coverage: ${totals.lines.toFixed(2)}% lines, ${totals.functions.toFixed(2)}% functions\n`)
  if (!verdict.ok) {
    verdict.failures.forEach((failure) => process.stderr.write(`coverage gate: ${failure}\n`))
    process.exitCode = 1
  }
}
