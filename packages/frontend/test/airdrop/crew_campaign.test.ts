// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { crew_dialogue } from '../../src/airdrop/crew_campaign.ts'
import { initial_blast_state } from '../../src/kares/blast.ts'

const input = {
  sale: {
    ...initial_blast_state(),
    ready: true,
    snapshot: {
      phase: 'complete' as const,
      version: '1',
      clock_ms: 1n,
      committed: 1n,
      target: 1n,
      progress_bps: 10000,
      start_ms: 0n,
      end_ms: 1n,
      token_allocation: 1n,
    },
  },
  connected: true,
  loaded: true,
  ready: false,
  claimed: false,
  pending: null,
  error: null,
}

test('an empty existing airdrop never invents participant or claim history', () => {
  expect(crew_dialogue(input)).toBe('empty')
  expect(crew_dialogue({ ...input, loaded: false })).toBe('checking')
  expect(crew_dialogue({ ...input, connected: false })).toBe('connect')
  expect(crew_dialogue({ ...input, error: 'offline' })).toBe('unavailable')
})

test('existing gift and receipt state selects collection dialogue', () => {
  expect(crew_dialogue({ ...input, ready: true })).toBe('ready')
  expect(crew_dialogue({ ...input, claimed: true })).toBe('claimed')
  expect(crew_dialogue({ ...input, ready: true, pending: 'redeem' })).toBe('claiming')
  expect(crew_dialogue({ ...input, pending: 'load' })).toBe('checking')
})

test('the existing sale reader supplies the invitation without adding eligibility reads', () => {
  expect(crew_dialogue({ ...input, sale: { ...initial_blast_state(), ready: true } })).toBe('intro')
  expect(crew_dialogue({ ...input, sale: { ...initial_blast_state(), ready: true, error: true } })).toBe('unavailable')
})
