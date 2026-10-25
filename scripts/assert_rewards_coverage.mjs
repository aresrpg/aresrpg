// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'

// Owner-approved exception: Sui's unit store cannot resolve a published upgraded package.
// The successful native return is exercised by scripts/integration/rewards_upgrade.ts.
// Pin the complete setup instruction stream: compiler or function changes require review,
// never silently relocate this exception or count its instruction as executed.
const SETUP_BYTECODE = 'deecc200b20c31beb82a586ccfe412b89009d1094699fdae43df3eb56d34a98f'

const instructions = (report) => {
  const functions = [
    ...stripVTControlCharacters(report).matchAll(
      /^(?:public(?:\(package\))? )?(\w+)(?:<.*>)?\([^\n]*\)[^\n]*\{\n([\s\S]*?)^}/gm
    ),
  ]
  return functions.flatMap(([, function_name, body]) =>
    [...body.matchAll(/^\s*(?:\[(\d+)\]\s*)?(\d+): (.+)$/gm)].map(([, hits, offset, opcode], pc) => {
      assert.equal(Number(offset), pc, 'Incomplete instruction report')
      return { function_name, pc, opcode, hits: Number(hits ?? 0) }
    })
  )
}

const coverage_counts = (csv) => {
  const [header, ...lines] = csv.trim().split('\n')
  // Sui 1.82.3 labels this column "Uncovered", but summarize_csv writes fn_summary.total.
  assert.equal(header, 'ModuleName,FunctionName,Covered,Uncovered', 'Unknown coverage CSV format')
  return lines.map((line) => {
    const match = line.match(/^0{64}::(\w+),(\w+),(\d+),(\d+)$/)
    assert.ok(match, 'Malformed function coverage')
    const [, module_name, function_name, covered, total] = match
    return { module_name, function_name, covered: Number(covered), total: Number(total) }
  })
}

export const assert_rewards_coverage = (summary, bytecode, csv) => {
  const modules = [...summary.matchAll(/^Module 0{64}::(\w+)\n>>> % Module coverage: (\d+\.\d+)$/gm)]
  assert.ok(modules.length > 0, 'Missing module coverage')
  assert.equal(modules.length, [...summary.matchAll(/^Module /gm)].length, 'Malformed module coverage')
  assert.equal(new Set(modules.map((row) => row[1])).size, modules.length, 'Duplicate module coverage')
  assert.equal(modules.filter((row) => row[1] === 'economy').length, 1, 'Missing economy coverage')
  const counts = coverage_counts(csv)
  assert.equal(
    new Set(counts.map((row) => `${row.module_name}::${row.function_name}`)).size,
    counts.length,
    'Duplicate function coverage'
  )
  assert.deepEqual(
    [...new Set(counts.map((row) => row.module_name))].sort(),
    modules.map((row) => row[1]).sort(),
    'Summary and function inventory disagree'
  )
  for (const row of counts) {
    const exempt = Number(row.module_name === 'economy' && row.function_name === 'setup')
    assert.equal(
      row.covered,
      row.total - exempt,
      `${row.module_name}::${row.function_name} has unexpected uncovered instructions`
    )
  }

  assert.match(bytecode, /^module 0\.economy \{$/m, 'Wrong bytecode module')
  assert.match(bytecode, /^use 0{63}2::package;$/m, 'The lookup must resolve the Sui framework package')
  const rows = instructions(bytecode)
  const setup = rows.filter((row) => row.function_name === 'setup')
  const fingerprint = createHash('sha256')
    .update(setup.map(({ pc, opcode }) => `${pc}: ${opcode}`).join('\n'))
    .digest('hex')
  assert.equal(fingerprint, SETUP_BYTECODE, 'Setup bytecode changed; review the coverage exception')
  const uncovered = rows.filter((row) => row.hits === 0)
  assert.deepEqual(
    uncovered,
    [{ function_name: 'setup', pc: 33, opcode: 'StLoc[9](%#2: ID)', hits: 0 }],
    'Only the reviewed native-return instruction may be uncovered; remove the exception if it becomes covered'
  )
  const actual = ((100 * (rows.length - uncovered.length)) / rows.length).toFixed(2)
  assert.equal(modules.find((row) => row[1] === 'economy')[2], actual, 'Summary and bytecode coverage disagree')
  assert.equal(
    rows.length,
    counts.filter((row) => row.module_name === 'economy').reduce((sum, row) => sum + row.total, 0),
    'Incomplete economy bytecode report'
  )
}

if (import.meta.main) {
  const summary = readFileSync(0, 'utf8')
  const bytecode = execFileSync(
    'sui',
    ['move', 'coverage', 'bytecode', '--path', 'packages/rewards', '--module', 'economy'],
    { encoding: 'utf8' }
  )
  const csv = execFileSync('sui', ['move', 'coverage', 'summary', '--path', 'packages/rewards', '--csv'], {
    encoding: 'utf8',
  })
  assert_rewards_coverage(summary, bytecode, csv)
  console.log(
    'Move coverage exception: economy::setup PC 33, native package lookup continuation (verified on localnet).'
  )
  console.log('Move coverage: packages/rewards 100% of non-exempt instructions; raw report retained above.')
}
