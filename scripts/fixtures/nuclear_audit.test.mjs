// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { scan_clones, scan_multi_importers, scan_repeated_literals } from '../nuclear_audit.mjs'

const fixture_source = (name) => readFileSync(new URL(`./nuclear_audit/${name}`, import.meta.url), 'utf8')
const audit_script = fileURLToPath(new URL('../nuclear_audit.mjs', import.meta.url))
const ratchet_baseline = fileURLToPath(new URL('./nuclear_audit/ratchet_baseline.json', import.meta.url))

const virtual_file = (path, fixture_name) => ({
  path,
  source: fixture_source(fixture_name),
})

test('clone scanner detects a planted structurally similar ten-line pair', () => {
  const files = [
    virtual_file('packages/alpha/src/settle.js', 'clone_a.js'),
    virtual_file('packages/beta/src/reconcile.js', 'clone_b.js'),
  ]

  const findings = scan_clones(files)

  assert.equal(findings.length, 1)
  assert.ok(findings[0].line_count >= 10)
  assert.deepEqual(
    findings[0].homes.map(({ path }) => path),
    ['packages/alpha/src/settle.js', 'packages/beta/src/reconcile.js']
  )
})

test('multi-importer scanner detects a planted second importer', () => {
  const raw_path = 'packages/sdk/src/raw_client.js'
  const files = [
    virtual_file(raw_path, 'raw_source.js'),
    virtual_file('packages/alpha/src/read.js', 'importer_a.js'),
    virtual_file('packages/beta/src/read.js', 'importer_b.js'),
  ]

  const findings = scan_multi_importers(files, [raw_path])

  assert.equal(findings.length, 1)
  assert.equal(findings[0].raw_source, raw_path)
  assert.deepEqual(
    findings[0].importers.map(({ path }) => path),
    ['packages/alpha/src/read.js', 'packages/beta/src/read.js']
  )
})

test('repeated-literal scanner detects a planted literal in three source files', () => {
  const files = ['a', 'b', 'c'].map((name) => virtual_file(`packages/${name}/src/value.js`, `literal_${name}.js`))

  const findings = scan_repeated_literals(files)

  const planted = findings.find(({ literal }) => literal === 'shared-state-key')
  assert.ok(planted)
  assert.equal(planted.homes.length, 3)
})

test('ratchet exits 1 on count growth', () => {
  const result = spawnSync(
    process.execPath,
    [
      audit_script,
      '--ratchet-counts',
      JSON.stringify({ clones: 2, multi_importers: 1, repeated_literals: 1 }),
      '--baseline',
      ratchet_baseline,
    ],
    { encoding: 'utf8' }
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /grew from 1 to 2/)
})

test('ratchet exits 0 and suggests a baseline update on count shrink', () => {
  const result = spawnSync(
    process.execPath,
    [
      audit_script,
      '--ratchet-counts',
      JSON.stringify({ clones: 0, multi_importers: 1, repeated_literals: 1 }),
      '--baseline',
      ratchet_baseline,
    ],
    { encoding: 'utf8' }
  )

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Suggested baseline/)
  assert.match(result.stdout, /"clones": 0/)
})
