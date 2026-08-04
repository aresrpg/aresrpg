#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// GAS PROBE — the zone-claim measurement behind #2194, one command.
//
// `aresrpg::zone_claim_gas_probe_tests` stands up a PRODUCTION-density zone (48 groups, the seeders' pinned
// DENSITY floor; a 64-row mob table) and runs probes that share their setup byte-for-byte and differ by exactly
// one call. The unit-test VM meters each test; this script runs them, subtracts the shared baseline, and prints
// the per-leg compute. The numbers are Move-VM gas units — a deterministic local proxy for on-chain COMPUTATION,
// not a MIST price and not storage.
//
//   node packages/move/scripts/gas_probe_zone_claim.mjs
import { execFileSync } from 'node:child_process'

const PROBES = {
  probe_0_baseline: 'baseline (search + witness, no claim)',
  probe_1_derive_claim: 'CLAIM DOOR — derive (format 3, re-derives the zone)',
  probe_2_proof_claim: 'CLAIM DOOR — proof  (format 4, one inclusion path)',
  probe_3_derivation_only: 'mechanism  — one full zone derivation',
  probe_4_path_verify_only: 'mechanism  — one inclusion verify',
  probe_5_format_3_commitment: 'SEARCH     — format-3 whole-set commitment (+1 derivation)',
  probe_6_format_4_tree: 'SEARCH     — format-4 Merkle tree (+1 derivation)',
}

const out = execFileSync(
  'sui',
  // the filter goes BEFORE -s: `--statistics` takes an OPTIONAL value, so a trailing filter is swallowed as a
  // format name and the whole suite runs instead
  ['move', 'test', '--path', 'packages/move/aresrpg', 'zone_claim_gas_probe', '-s'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)

// the statistics table's rows are `│ <fully qualified test> │ <seconds> │ <gas used> │`
const gas = new Map()
for (const line of out.split('\n')) {
  const row = line.match(/zone_claim_gas_probe_tests::(\w+)\s*│[^│]*│\s*(\d+)\s*│/)
  if (row) gas.set(row[1], Number(row[2]))
}
const missing = Object.keys(PROBES).filter(name => !gas.has(name))
if (missing.length)
  throw new Error(
    `[gas-probe] the statistics table is missing ${missing.join(', ')} — the probe module or the -s output shape changed, and a partial table would print a plausible lie`,
  )

const base = gas.get('probe_0_baseline')
const cost = name => gas.get(name) - base
console.log('\nZONE CLAIM GAS PROBE (#2194) — Move-VM gas units, baseline subtracted\n')
for (const [name, label] of Object.entries(PROBES))
  console.log(`  ${label.padEnd(58)} ${name === 'probe_0_baseline' ? '(reference)' : cost(name).toLocaleString()}`)

const before = cost('probe_1_derive_claim')
const after = cost('probe_2_proof_claim')
const search = cost('probe_6_format_4_tree') - cost('probe_5_format_3_commitment')
console.log(`\n  CLAIM     ${before.toLocaleString()} → ${after.toLocaleString()} units  (${(before / after).toFixed(2)}×, −${(((before - after) / before) * 100).toFixed(1)}%)`)
console.log(`  SEARCH    +${search.toLocaleString()} units once per zone`)
console.log(`  BREAK-EVEN after ${(search / (before - after)).toFixed(2)} claims\n`)
