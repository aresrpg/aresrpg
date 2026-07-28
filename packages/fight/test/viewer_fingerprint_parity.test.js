// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Permanent class gate for #1336: a recorded cooperative fight is one canonical fold. Viewer identity may select
// controls, never truth, so actor / partner / spectator must publish the exact same per-turn fingerprints.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { participant_entity_id } from '../src/fight_control.js'
import { empty_core_state, fight_fingerprint, ingest } from '../src/core.js'

// The recorded cooperative capsule, addressed by its CAPTURE STAMP: the fight id its filename carries is
// evidence inside the sanctioned capsule corpus, so this file reads it rather than transcribing it (the
// chain-id gate's rule — a test that CAN read its evidence never hardcodes an id out of it).
const CAPTURED_AT = 1_784_658_245_869
const CAPSULES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'capsules')
const FIXTURE = readdirSync(CAPSULES_DIR).find((name) => name.endsWith(`-${CAPTURED_AT}.capsule.json`))
const capsule = JSON.parse(readFileSync(join(CAPSULES_DIR, FIXTURE), 'utf8'))

/** The fight's seated participants, read off the capsule's own adopted view — never a transcribed roster. */
const participant_ids = () => {
  let state = empty_core_state(capsule.session_id ?? null)
  for (const envelope of capsule.capsules) state = ingest(state, envelope)
  return (state.inbox?.base_view?.escrow ?? []).map((row) => participant_entity_id(row)).filter(Boolean)
}

const viewer_contexts = () => {
  const [actor, partner] = participant_ids()
  return [
    { label: 'actor', my_entity_id: actor, spectator: false },
    { label: 'partner', my_entity_id: partner, spectator: false },
    { label: 'spectator', my_entity_id: null, spectator: true },
  ]
}

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
    const contexts = viewer_contexts()
    // The capsule must actually seat two DISTINCT players, or "identical across viewers" is vacuously true.
    expect(contexts[0].my_entity_id).toBeTruthy()
    expect(contexts[1].my_entity_id).toBeTruthy()
    expect(contexts[1].my_entity_id).not.toBe(contexts[0].my_entity_id)
    const sequences = contexts.map(({ label, ...viewer }) => ({ label, sequence: replay_as(viewer) }))
    expect(sequences[1].sequence).toEqual(sequences[0].sequence)
    expect(sequences[2].sequence).toEqual(sequences[0].sequence)
    expect(sequences[0].sequence.length).toBeGreaterThan(2)
    expect(new Set(sequences[0].sequence.map((row) => row.hash)).size).toBeGreaterThan(2)
  })
})
