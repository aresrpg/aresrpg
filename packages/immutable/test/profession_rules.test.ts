// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { craft_job_of, gather_gate, job_xp_for_level } from '../src/index.ts'

test('fixed category craft jobs override authoring; ambiguous categories use the authored job', () => {
  expect(craft_job_of('sword', 'FARMER')).toBe('FORGER')
  expect(craft_job_of('consumable', 'FARMER')).toBe('FARMER')
  expect(craft_job_of('consumable')).toBeNull()
})

test('gathering checks level first and accepts any matching tool without a tool-level gate', () => {
  const resource = { job: 'MINER', tier: 2 }
  expect(gather_gate({ jobs: {}, equipment: [] }, resource)).toMatchObject({ ok: false, reason: 'level' })
  const jobs = { MINER: job_xp_for_level(100)! }
  expect(gather_gate({ jobs, equipment: [{ slot: 'tool', category: 'tool_farmer' }] }, resource)).toEqual({
    ok: false,
    reason: 'tool',
    job: 'MINER',
  })
  expect(gather_gate({ jobs, equipment: [{ slot: 'tool', category: 'tool_miner' }] }, resource)).toEqual({ ok: true })
})
