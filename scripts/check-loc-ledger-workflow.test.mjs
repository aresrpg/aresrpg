// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The LoC ledger charges a diff on its entry to edge. These controls evaluate the real workflow
// job condition so that the same already-charged diff skips only on the master promotion hop.
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

function condition_matches(condition, event) {
  const values = new Map([
    ['github.event_name', event.event_name],
    ['github.event.pull_request.base.ref', event.base_ref],
  ])
  return condition.split(/\s*&&\s*/).every((clause) => {
    const match = clause.match(/^(github(?:\.[a-z_]+)+)\s*(==|!=)\s*'([^']+)'$/)
    if (!match) throw new Error(`unsupported loc-ledger condition clause: ${clause}`)
    const actual = values.get(match[1])
    if (actual === undefined) throw new Error(`unsupported loc-ledger condition value: ${match[1]}`)
    return match[2] === '==' ? actual === match[3] : actual !== match[3]
  })
}

describe('LoC ledger workflow scope', () => {
  it('runs for a normal PR and skips the same already-charged diff on promotion', () => {
    const historical_range = 'same-base..same-trailer-less-head'
    const normal_event = {
      event_name: 'pull_request',
      base_ref: 'edge',
      range: historical_range,
    }
    const promotion_event = {
      event_name: 'pull_request',
      base_ref: 'master',
      range: historical_range,
    }
    const condition = loc_ledger_condition()
    const normal = condition_matches(condition, normal_event)
    const promotion = condition_matches(condition, promotion_event)
    if (process.env.PROMOTION_GATE_EVIDENCE === '1') {
      console.log(`LoC normal PR negative control: ${normal ? 'RUN' : 'SKIP'} (${normal_event.range})`)
      console.log(`LoC promotion control: ${promotion ? 'RUN' : 'SKIP'} (${promotion_event.range})`)
      console.log(`LoC job if: ${condition}`)
    }

    expect(normal_event.range).toBe(promotion_event.range)
    expect(normal).toBe(true)
    expect(promotion).toBe(false)
    expect(condition).toBe("github.event_name == 'pull_request' && github.event.pull_request.base.ref != 'master'")
  })
})
