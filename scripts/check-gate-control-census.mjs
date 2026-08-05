#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const repo_root = path.resolve(path.dirname(script_path), '..')
const expected_controls = [
  'test-reachability',
  'fixture-adjudication',
  'doc-references',
  'manifest-lineage',
  'chain-ids',
  'sim-constants',
  'entropy-before-validation',
  'registry-fence',
]

const definitions = [
  {
    id: 'test-reachability',
    file: 'scripts/check-constraints.sh',
    markers: ['fresh_orphan.test.mjs', 'test_reachability_hits', 'test_reachability_gate'],
  },
  {
    id: 'fixture-adjudication',
    file: 'scripts/check-constraints.sh',
    markers: ['fixture_adjudication_blind_guard', 'fresh-control.json', 'fixture_adjudication_controlled_gate'],
  },
  {
    id: 'doc-references',
    file: 'scripts/check-doc-file-references.mjs',
    markers: ['doc_reference_blind_guard', 'fresh_unresolved=', 'blind guard did not reject'],
  },
  {
    id: 'manifest-lineage',
    file: 'scripts/check-manifest-lineage.mjs',
    markers: ['fresh_lineage_control_fires', 'fresh_stale_lineage_rejected=', 'Blind guard did not reject'],
  },
  {
    id: 'chain-ids',
    file: 'scripts/check-chain-ids.mjs',
    markers: ['fresh_control_rogue_count', 'fresh_synthetic_rogue=', 'Matcher blind guard'],
  },
  {
    id: 'sim-constants',
    file: 'scripts/sim-constants-gate.sh',
    markers: [
      'FIXTURE_ROOT="scripts/arch/fixtures/sim_constants"',
      '"$FIXTURE_ROOT/red"',
      '"$FIXTURE_ROOT/green"',
      '--expect',
    ],
  },
  {
    id: 'entropy-before-validation',
    file: 'scripts/entropy-before-validation-gate.sh',
    markers: [
      'FIXTURE_ROOT="scripts/arch/fixtures/entropy_before_validation"',
      '"$FIXTURE_ROOT/red"',
      '"$FIXTURE_ROOT/green"',
      '--expect',
    ],
  },
  // #2222: the registry fence is GENERATED, so the one thing that can rot silently is the parser
  // that reads docs/REGISTRY.md — it would keep printing a green verdict over zero rules. The
  // control plants a row in a copy of the registry and demands its rule appear, with the blind
  // guard that the untouched registry does not already carry it.
  {
    id: 'registry-fence',
    file: 'scripts/single-home-gate.sh',
    markers: ['CONTROL_REGISTRY="$(mktemp)"', 'a planted registry row generated NO fence', '--fences'],
  },
]

export const validate_control_ids = (controls) => {
  const ids = controls.map(({ id }) => id)
  const missing = expected_controls.filter((id) => !ids.includes(id))
  const unexpected = ids.filter((id) => !expected_controls.includes(id))
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  return { missing, unexpected, duplicates }
}

const fixture_index = process.argv.indexOf('--fixture')
const controls =
  fixture_index === -1
    ? definitions
    : JSON.parse(fs.readFileSync(path.resolve(repo_root, process.argv[fixture_index + 1]), 'utf8')).controls
const { missing, unexpected, duplicates } = validate_control_ids(controls)
const errors = []

if (missing.length) errors.push(`missing controls: ${missing.join(', ')}`)
if (unexpected.length) errors.push(`unexpected controls: ${unexpected.join(', ')}`)
if (duplicates.length) errors.push(`duplicate controls: ${duplicates.join(', ')}`)

if (fixture_index === -1)
  for (const control of controls) {
    const file_path = path.join(repo_root, control.file)
    if (!fs.existsSync(file_path)) {
      errors.push(`${control.id}: missing ${control.file}`)
      continue
    }
    const source = fs.readFileSync(file_path, 'utf8')
    for (const marker of control.markers)
      if (!source.includes(marker)) errors.push(`${control.id}: ${control.file} lost marker ${JSON.stringify(marker)}`)
  }

if (errors.length) {
  console.error('GATE CONTROL CENSUS FAILED')
  errors.forEach((error) => console.error(`  ${error}`))
  process.exit(1)
}

console.log(`GATE CONTROL CENSUS PASSED: ${controls.length} synthetic controls remain armed`)
