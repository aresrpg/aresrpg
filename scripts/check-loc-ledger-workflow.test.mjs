// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The LoC ledger charges a diff on its entry to edge. These controls evaluate the real workflow
// job condition so only this repo's already-charged master promotion skips the gate.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { describe, expect, it } from 'bun:test'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const checks_path = path.resolve(script_dir, '../.github/workflows/checks.yml')

function loc_ledger_condition() {
  const lines = fs.readFileSync(checks_path, 'utf8').split('\n')
  const job_start = lines.findIndex((line) => line === '  loc-ledger:')
  if (job_start === -1) throw new Error('checks.yml has no loc-ledger job')
  const condition = lines
    .slice(job_start + 1)
    .find((line) => line.startsWith('    if: '))
    ?.slice('    if: '.length)
  if (!condition) throw new Error('the loc-ledger job has no if condition')
  return condition
}

function clause_matches(clause, values) {
  const match = clause.match(/^(github(?:\.[a-z_]+)+)\s*(==|!=)\s*(?:'([^']+)'|(github(?:\.[a-z_]+)+))$/)
  if (!match) throw new Error(`unsupported loc-ledger condition clause: ${clause}`)
  const actual = values.get(match[1])
  const expected = match[3] ?? values.get(match[4])
  if (actual === undefined) throw new Error(`unsupported loc-ledger condition value: ${match[1]}`)
  if (expected === undefined) throw new Error(`unsupported loc-ledger condition value: ${match[4]}`)
  return match[2] === '==' ? actual === expected : actual !== expected
}

function condition_matches(condition, event) {
  const values = new Map([
    ['github.event_name', event.event_name],
    ['github.event.pull_request.base.ref', event.base_ref],
    ['github.event.pull_request.head.repo.full_name', event.head_repo],
    ['github.repository', event.repository],
  ])
  return condition.split(/\s*&&\s*/).every((group) => {
    const clauses = group.replace(/^\((.*)\)$/, '$1').split(/\s*\|\|\s*/)
    return clauses.some((clause) => clause_matches(clause, values))
  })
}

describe('LoC ledger workflow scope', () => {
  it('runs for normal and fork PRs while skipping only the same-repo promotion', () => {
    const historical_range = 'same-base..same-trailer-less-head'
    const normal_event = {
      event_name: 'pull_request',
      base_ref: 'edge',
      head_repo: 'aresrpg/aresrpg',
      repository: 'aresrpg/aresrpg',
      range: historical_range,
    }
    const promotion_event = {
      event_name: 'pull_request',
      base_ref: 'master',
      head_repo: 'aresrpg/aresrpg',
      repository: 'aresrpg/aresrpg',
      range: historical_range,
    }
    const fork_event = {
      event_name: 'pull_request',
      base_ref: 'master',
      head_repo: 'contributor/aresrpg',
      repository: 'aresrpg/aresrpg',
      range: historical_range,
    }
    const condition = loc_ledger_condition()
    const normal = condition_matches(condition, normal_event)
    const promotion = condition_matches(condition, promotion_event)
    const fork = condition_matches(condition, fork_event)
    if (process.env.PROMOTION_GATE_EVIDENCE === '1') {
      console.log(`LoC normal PR negative control: ${normal ? 'RUN' : 'SKIP'} (${normal_event.range})`)
      console.log(`LoC promotion control: ${promotion ? 'RUN' : 'SKIP'} (${promotion_event.range})`)
      console.log(`LoC fork-to-master control: ${fork ? 'RUN' : 'SKIP'} (${fork_event.head_repo})`)
      console.log(`LoC fork promotion-shape skip: ${fork ? 'FALSE' : 'TRUE'}`)
      console.log(`LoC job if: ${condition}`)
    }

    expect(normal_event.range).toBe(promotion_event.range)
    expect(normal_event.range).toBe(fork_event.range)
    expect(normal).toBe(true)
    expect(promotion).toBe(false)
    expect(fork).toBe(true)
    expect(condition).toBe(
      "github.event_name == 'pull_request' && (github.event.pull_request.base.ref != 'master' || github.event.pull_request.head.repo.full_name != github.repository)"
    )
  })
})
