// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/trace_export.test.js — the dual-capsule export (spec §8): both shipped formats in one file, with
// the determinism seed recoverable from each half.

import { describe, expect, test } from 'bun:test'

import { capsule_export } from '@aresrpg/fight/capsule'

import {
  SIM_TRACE_FORMAT,
  build_sim_trace,
  export_sim_trace,
  push_trace_ring,
  seed_from_fight_id,
  sim_fight_id,
  trace_filename,
} from './trace_export.js'

const SEED = 0xc81f3a92
const FIGHT_ID = sim_fight_id(SEED, 1)

/** A real trace_format-2 capsule from the shipped producer — never a hand-shaped lookalike. */
const envelope = (session_id = FIGHT_ID) =>
  capsule_export({ session_id, app_version: 'test', captured_at: 1_700_000_000_000, capsules: [] })

/** The sim capsule's meta is where `timeline.js` carries the seed (spec §8 row 2). */
const sim_capsule = (seed = SEED) => ({
  meta: { seed, fight_seed: seed },
  arena: { width: 11, height: 11 },
  templates_raw: [],
  initial: {},
  commands: [{ type: 'ready', entity_id: 'sim_c1' }],
})

describe('the fight id IS the determinism root (spec §4.7)', () => {
  test('round-trips seed → id → seed', () => {
    expect(FIGHT_ID).toBe('sim:c81f3a92:1')
    expect(seed_from_fight_id(FIGHT_ID)).toBe(SEED)
  })

  test('a foreign fight id yields no seed rather than a plausible wrong one', () => {
    expect(seed_from_fight_id('0xdeadbeef')).toBeNull()
    expect(seed_from_fight_id('sim:xyz:1')).toBeNull()
    expect(seed_from_fight_id(null)).toBeNull()
  })

  test('the filename carries the seed and survives a filesystem', () => {
    expect(trace_filename(SEED, FIGHT_ID)).toBe('aresrpg-simfight-c81f3a92-sim_c81f3a92_1.json')
  })
})

describe('the payload carries BOTH shipped formats, with the seed in each', () => {
  test('it bundles the sim capsule and the trace_format-2 envelope capsule', () => {
    const trace = build_sim_trace({ seed: SEED, fight_id: FIGHT_ID, sim_capsule: sim_capsule(), envelope_capsule: envelope() })
    expect(trace.format).toBe(SIM_TRACE_FORMAT)
    expect(trace.seed).toBe(SEED)
    // half 1 — the sim capsule's own meta (replayed by timeline.js replay_capsule)
    expect(trace.sim_capsule.meta.seed).toBe(SEED)
    expect(trace.sim_capsule.commands.length).toBeGreaterThan(0)
    // half 2 — the envelope capsule, whose session id IS the seed-bearing fight id (replayed by v2/replay.js)
    expect(seed_from_fight_id(trace.envelope_capsule.session_id)).toBe(SEED)
    expect(trace.envelope_capsule.trace_format).toBe(2) // trace_format-2, the shipped envelope format
  })

  test('a capsule from ANOTHER fight is refused — a mismatched pair looks like a sim bug on replay', () => {
    expect(() =>
      build_sim_trace({ seed: SEED, fight_id: FIGHT_ID, sim_capsule: sim_capsule(), envelope_capsule: envelope(sim_fight_id(SEED, 2)) })
    ).toThrow(/envelope capsule is for/)
  })

  test('a seed that disagrees with the fight id is refused', () => {
    expect(() => build_sim_trace({ seed: 1, fight_id: FIGHT_ID, sim_capsule: null, envelope_capsule: null })).toThrow(
      /recorded seed is/
    )
  })

  test('a non-simulator fight id is refused', () => {
    expect(() => build_sim_trace({ seed: SEED, fight_id: '0xabc', sim_capsule: null, envelope_capsule: null })).toThrow(
      /not a sim:/
    )
  })
})

describe('the export edge', () => {
  test('it downloads ONE json file named for the seed, and rings the trace', () => {
    const downloads = []
    const saved = []
    const result = export_sim_trace({
      seed: SEED,
      fight_id: FIGHT_ID,
      sim_capsule: sim_capsule(),
      dump_envelope: () => envelope(),
      download: (filename, text) => downloads.push({ filename, text }),
      save: (trace) => saved.push(trace),
      now: () => 1_700_000_000_001,
    })
    expect(result.ok).toBe(true)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].filename).toBe('aresrpg-simfight-c81f3a92-sim_c81f3a92_1.json')
    const parsed = JSON.parse(downloads[0].text)
    expect(parsed.sim_capsule.meta.seed).toBe(SEED)
    expect(parsed.envelope_capsule.session_id).toBe(FIGHT_ID)
    expect(saved).toHaveLength(1)
  })

  test('BigInt fields survive the stringify (the chain u64s a snapshot input carries verbatim)', () => {
    const downloads = []
    export_sim_trace({
      seed: SEED,
      fight_id: FIGHT_ID,
      sim_capsule: { meta: { seed: SEED }, world_seed: 12345n },
      dump_envelope: () => null,
      download: (filename, text) => downloads.push(text),
    })
    expect(downloads).toHaveLength(1)
    expect(() => JSON.parse(downloads[0])).not.toThrow()
    expect(downloads[0]).toContain('12345')
  })

  test('nothing captured ⇒ NO file — never a fabricated empty trace', () => {
    const downloads = []
    const result = export_sim_trace({
      seed: SEED,
      fight_id: FIGHT_ID,
      sim_capsule: null,
      dump_envelope: () => null,
      download: () => downloads.push(1),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('nothing_captured')
    expect(downloads).toHaveLength(0)
  })
})

describe('the IDB traces ring', () => {
  test('newest first, bounded, one row per fight', () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({ fight_id: sim_fight_id(SEED, index), seed: SEED }))
    const ring = rows.reduce((acc, row) => push_trace_ring(acc, row), [])
    expect(ring).toHaveLength(10)
    expect(ring[0].fight_id).toBe(sim_fight_id(SEED, 13))
  })

  test('re-exporting a fight replaces its row instead of duplicating it', () => {
    const first = push_trace_ring([], { fight_id: FIGHT_ID, captured_at: 1 })
    const again = push_trace_ring(first, { fight_id: FIGHT_ID, captured_at: 2 })
    expect(again).toHaveLength(1)
    expect(again[0].captured_at).toBe(2)
  })
})
