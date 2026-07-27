// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Permanent class gate for #1336: a recorded cooperative fight is one canonical fold. Viewer identity may select
// controls, never truth, so actor / partner / spectator must publish the exact same per-turn fingerprints.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { empty_core_state, fight_fingerprint, ingest } from '../src/core.js'

const FIXTURE =
  '0x9a062c08605fea9cf663edc1617643496c09f6c07d919c16e67edbf9ae0adaa6-1784658245869.capsule.json'
const capsule = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'capsules', FIXTURE), 'utf8')
)

const participant_ids = [
  '0x409b0967dcc218d2e84525e3a8ffb0ece61d7ffd9ce3b85352f72a840e529fba',
  '0xc00f5791c883c391b704088a25ccd61cccb77ac805761d1762d4e7543a8adc79',
]

const contexts = [
  { label: 'actor', my_entity_id: participant_ids[0], spectator: false },
  { label: 'partner', my_entity_id: participant_ids[1], spectator: false },
  { label: 'spectator', my_entity_id: null, spectator: true },
]

const replay_as = (viewer) => {
  let state = empty_core_state(capsule.session_id ?? null)
  const sequence = []
  let last = null
  for (const envelope of capsule.capsules) {
    const next =
      envelope.payload.kind === 'session_opened'
        ? {
            ...envelope,
            payload: {
              ...envelope.payload,
              ctx: { ...(envelope.payload.ctx ?? {}), ...viewer },
              my_key: null,
            },
          }
        : envelope
    state = ingest(state, next)
    if (next.payload.kind !== 'journal_rows_received') continue
    const fingerprint = fight_fingerprint(state)
    if (fingerprint.turn_ordinal == null || fingerprint.hash === last) continue
    last = fingerprint.hash
    sequence.push(fingerprint)
  }
  return sequence
}

describe('multi-viewer fingerprint class gate — recorded cooperative capsule', () => {
  test('actor, partner and spectator fold identical canonical fingerprints', () => {
    const sequences = contexts.map(({ label, ...viewer }) => ({ label, sequence: replay_as(viewer) }))
    expect(sequences[1].sequence).toEqual(sequences[0].sequence)
    expect(sequences[2].sequence).toEqual(sequences[0].sequence)
    expect(sequences[0].sequence.length).toBeGreaterThan(2)
    expect(new Set(sequences[0].sequence.map((row) => row.hash)).size).toBeGreaterThan(2)
  })
})
