// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Bun's native threshold is per file. This gate retains every loaded handwritten file and checks
// the repository-wide LCOV distribution instead of manufacturing a giant low-coverage ignore list.

import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

export const COVERAGE_FLOOR = Object.freeze({ lines: 60, functions: 75 })

// Native LCOV only describes loaded modules. Census executable sources without importing
// workers, servers, or browser entries just to manufacture coverage.
export const has_runtime = (source, file_name) => {
  if (file_name.endsWith('.d.ts')) return false
  const { outputText } = ts.transpileModule(source, {
    fileName: file_name,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  })
  return ts
    .createSourceFile('output.js', outputText, ts.ScriptTarget.Latest)
    .statements.some((statement) =>
      ts.isImportDeclaration(statement)
        ? !statement.importClause
        : !ts.isExportDeclaration(statement) && !ts.isEmptyStatement(statement)
    )
}

export const coverage_census = (lcov, sources) => {
  const loaded = new Set(
    lcov
      .split('\n')
      .filter((line) => line.startsWith('SF:'))
      .map((line) => path.resolve(line.slice(3)))
  )
  const missing = sources.filter((source) => !loaded.has(path.resolve(source)))
  return Object.freeze({
    files: sources.length,
    missing,
    loaded: percentage(sources.length - missing.length, sources.length),
  })
}

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
  const sources = ['packages/*/src/**/*.{ts,tsx,js,mjs}', 'scripts/**/*.{ts,tsx,js,mjs}']
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync('.')])
    .filter((file) => !/\.(?:test|spec|gen)\.[^.]+$/.test(file))
    .filter((file) => has_runtime(fs.readFileSync(file, 'utf8'), file))
  const census = coverage_census(fs.readFileSync(path, 'utf8'), sources)
  process.stdout.write(
    `coverage census: ${census.files - census.missing.length}/${census.files} executable files loaded (${census.loaded.toFixed(2)}%)\n`
  )
  process.stdout.write(census.missing.map((file) => `unloaded: ${file}\n`).join(''))
  if (census.loaded < 86) {
    process.stderr.write('coverage gate: fewer than 86% of executable files appear in native coverage\n')
    process.exitCode = 1
  }
  if (!verdict.ok) {
    verdict.failures.forEach((failure) => process.stderr.write(`coverage gate: ${failure}\n`))
    process.exitCode = 1
  }
}
