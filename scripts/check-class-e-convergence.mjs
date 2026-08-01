#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const repo_root = path.resolve(path.dirname(script_path), '..')
const default_fixture = 'packages/frontend/test/class-e/source_to_surface_convergence.test.js'
const fixture = process.argv[2] ?? default_fixture
const fixture_path = path.resolve(repo_root, fixture)
const expected_members = [1738, 1732, 1623, 1489, 1486, 1143, 1137, 1109, 1009, 760, 216, 1676]

if (!fs.existsSync(fixture_path)) {
  console.error(`CLASS-E CONVERGENCE GATE FAILED: fixture does not exist: ${fixture}`)
  process.exit(1)
}

const source = fs.readFileSync(fixture_path, 'utf8')
const members = [...source.matchAll(/\btest\('#(\d+)\b/g)].map((match) => Number(match[1]))
const missing = expected_members.filter((issue) => !members.includes(issue))
const unexpected = members.filter((issue) => !expected_members.includes(issue))
const duplicates = members.filter((issue, index) => members.indexOf(issue) !== index)

if (missing.length || unexpected.length || duplicates.length || members.length !== expected_members.length) {
  console.error('CLASS-E CONVERGENCE GATE FAILED: the twelve-member census changed')
  if (missing.length) console.error(`  missing: ${missing.map((issue) => `#${issue}`).join(', ')}`)
  if (unexpected.length) console.error(`  unexpected: ${unexpected.map((issue) => `#${issue}`).join(', ')}`)
  if (duplicates.length) console.error(`  duplicates: ${duplicates.map((issue) => `#${issue}`).join(', ')}`)
  process.exit(1)
}

const run = spawn_sync('bun', ['test', fixture], {
  cwd: repo_root,
  env: { ...process.env, ARES_SKIP_LIVE: '1' },
  stdio: 'inherit',
})

if (run.error) {
  console.error(`CLASS-E CONVERGENCE GATE FAILED: ${run.error.message}`)
  process.exit(1)
}
if (run.status !== 0) process.exit(run.status ?? 1)

console.log(`CLASS-E CONVERGENCE GATE PASSED: ${members.length} bounded transitions converged`)
