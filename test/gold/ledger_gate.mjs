#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COMPLAINT LEDGER GATE — every recurring complaint gets an impossible-to-fail gate. Parses
// test/gold/COMPLAINT_LEDGER.md and asserts every GATED row's test is DISCOVERABLE — the `File`
// exists AND literally contains the `Gate test (grep)` string. A renamed/deleted/missing gate makes this RED, so
// the ledger can never drift into referencing tests that no longer exist. GAP rows are counted + printed, never
// asserted (they are the honest, named remainder). Run standalone or via `bun ares test ledger`.
// BOUNDARY: this proves DISCOVERABILITY only — that a gate EXECUTES in a run is the ares pipeline's property
// (fight-family execution honesty = the anchor leg's driven-fight JSON gate), never this file's.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo_root = path.resolve(here, '..', '..')
const ledger_path = path.join(here, 'COMPLAINT_LEDGER.md')

/** Parse the fenced 4-column table into {complaint, grep, file, status} rows. */
export function parse_ledger(markdown) {
  const start = markdown.indexOf('LEDGER-TABLE-START')
  const end = markdown.indexOf('LEDGER-TABLE-END')
  if (start === -1 || end === -1 || end < start) throw new Error('ledger table markers missing or out of order')
  const block = markdown.slice(start, end)
  const rows = []
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length !== 4) continue
    const [complaint, grep, file, status] = cells
    if (complaint === 'Complaint' || /^-+$/.test(complaint)) continue // header + separator
    rows.push({ complaint, grep, file, status: status.toUpperCase() })
  }
  return rows
}

/** For a GATED row: the file must exist and literally contain the grep title. Returns null on pass, a reason on fail. */
function discoverability_failure(row) {
  const abs = path.join(repo_root, row.file)
  if (!fs.existsSync(abs)) return `file not found: ${row.file}`
  const body = fs.readFileSync(abs, 'utf8')
  if (!body.includes(row.grep)) return `"${row.grep}" not found in ${row.file}`
  return null
}

export function run() {
  let markdown
  try {
    markdown = fs.readFileSync(ledger_path, 'utf8')
  } catch (error) {
    console.error(`LEDGER GATE · cannot read COMPLAINT_LEDGER.md: ${error.message}`)
    return 1
  }
  let rows
  try {
    rows = parse_ledger(markdown)
  } catch (error) {
    console.error(`LEDGER GATE · ${error.message}`)
    return 1
  }
  const valid_status = rows.filter((r) => r.status !== 'GATED' && r.status !== 'GAP')
  if (valid_status.length) {
    console.error(
      `LEDGER GATE · rows with an unknown Status (must be GATED|GAP): ${valid_status.map((r) => r.complaint).join(' · ')}`
    )
    return 1
  }
  const gated = rows.filter((r) => r.status === 'GATED')
  const gaps = rows.filter((r) => r.status === 'GAP')
  if (rows.length === 0 || gated.length === 0) {
    console.error('LEDGER GATE · parsed zero GATED rows — the ledger table is empty or malformed')
    return 1
  }
  const failures = gated.map((row) => ({ row, reason: discoverability_failure(row) })).filter((x) => x.reason)

  console.log(`LEDGER GATE · ${rows.length} complaint classes · ${gated.length} GATED · ${gaps.length} GAP`)
  for (const gap of gaps) console.log(`  GAP  ${gap.complaint}  →  ${gap.file} (${gap.grep})`)
  if (failures.length) {
    console.error(`\nLEDGER GATE FAILED · ${failures.length} GATED row(s) reference a test that is NOT discoverable:`)
    for (const { row, reason } of failures) console.error(`  ✗ ${row.complaint}\n      ${reason}`)
    return 1
  }
  console.log(`LEDGER GATE PASSED · all ${gated.length} GATED complaints map to a discoverable test`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run()
}
