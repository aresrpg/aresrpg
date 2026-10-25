// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { assert_rewards_coverage } from '../assert_rewards_coverage.mjs'

import fixture from './fixtures/rewards_coverage.json' with { type: 'json' }

test('the Move gate runs the exception checker with Node and no Bun installation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-move-runtime-'))
  try {
    const bin = join(directory, 'bin')
    mkdirSync(bin)
    mkdirSync(join(directory, 'scripts'))
    symlinkSync(execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim(), join(bin, 'node'))
    copyFileSync(
      new URL('../assert_rewards_coverage.mjs', import.meta.url),
      join(directory, 'scripts/assert_rewards_coverage.mjs')
    )
    writeFileSync(join(directory, 'bytecode'), fixture.bytecode)
    writeFileSync(join(directory, 'csv'), fixture.csv)
    writeFileSync(
      join(bin, 'sui'),
      '#!/bin/sh\ncase "$*" in\n  *--csv) /bin/cat csv ;;\n  *--module*) /bin/cat bytecode ;;\n  *) exit 1 ;;\nesac\n',
      { mode: 0o755 }
    )
    const gate = readFileSync(new URL('../coverage_move.sh', import.meta.url), 'utf8')
    const [, command] = gate.match(/\| (.+scripts\/assert_rewards_coverage\.mjs)$/m)
    const output = execFileSync('/bin/sh', ['-c', command], {
      cwd: directory,
      env: { PATH: bin },
      input: fixture.summary,
      encoding: 'utf8',
    })
    expect(output).toContain('100% of non-exempt instructions')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('accepts only the captured native-return gap without changing raw coverage', () => {
  expect(() => assert_rewards_coverage(fixture.summary, fixture.bytecode, fixture.csv)).not.toThrow()
  expect(fixture.summary).toContain('99.94')
})

test('another uncovered instruction in setup fails', () => {
  const report = fixture.bytecode.replace('[9]\t34: MoveLoc[9]', '\t34: MoveLoc[9]')
  expect(report).not.toBe(fixture.bytecode)
  expect(() => assert_rewards_coverage(fixture.summary, report, fixture.csv)).toThrow('Only the reviewed')
})

test('another uncovered function fails even when summary rounding stays unchanged', () => {
  const report = fixture.bytecode.replace(/\[\d+\]\t0: CopyLoc\[0\]/, '\t0: CopyLoc[0]')
  expect(report).not.toBe(fixture.bytecode)
  expect(() => assert_rewards_coverage(fixture.summary, report, fixture.csv)).toThrow('Only the reviewed')
})

test('another module cannot borrow the exception', () => {
  // This ratio rounds to 100.00%; exact instruction counts must still reject it.
  const csv = fixture.csv.replace('amounts,combat_tokens,4,4', 'amounts,combat_tokens,65534,65535')
  expect(() => assert_rewards_coverage(fixture.summary, fixture.bytecode, csv)).toThrow('uncovered instructions')
})

test('a changed setup instruction requires a fresh review', () => {
  const report = fixture.bytecode.replace('33: StLoc[9]', '33: StLoc[8]')
  expect(() => assert_rewards_coverage(fixture.summary, report, fixture.csv)).toThrow('Setup bytecode changed')
})

test('an upstream harness fix requires removing the obsolete exception', () => {
  const report = fixture.bytecode.replace('\t33: StLoc[9]', '[1]\t33: StLoc[9]')
  expect(() => assert_rewards_coverage(fixture.summary, report, fixture.csv)).toThrow('remove the exception')
})

test('missing, malformed, or inconsistent reports fail closed', () => {
  expect(() => assert_rewards_coverage('', fixture.bytecode, fixture.csv)).toThrow('Missing module')
  expect(() => assert_rewards_coverage(fixture.summary, '', fixture.csv)).toThrow('Wrong bytecode')
  expect(() =>
    assert_rewards_coverage(fixture.summary.replace('99.66', '100.00'), fixture.bytecode, fixture.csv)
  ).toThrow('disagree')
  expect(() => assert_rewards_coverage(fixture.summary, fixture.bytecode, '')).toThrow('Unknown coverage CSV')
  expect(() => assert_rewards_coverage(fixture.summary, fixture.bytecode, `${fixture.csv}broken\n`)).toThrow(
    'Malformed function'
  )
})
