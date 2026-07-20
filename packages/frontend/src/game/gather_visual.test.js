// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER-NODE VISUAL RESOLVER — proof that a chain ResourceSpawn's (job, tier) maps to the right gatherable
// identity + family silhouette (ENGINE_AAA_PLAN §5.3). Pure, headless — no three, no engine. The map is the
// single home the in-world procedural prop (spawn_rigs.js create_gather_layer → synth_gather_buffer) reads. The
// ART itself (the procedural wheat/herb/ore sprite per id) is proven separately in the engine's gather_synth.test.js.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'
import { GATHER_RESOURCES } from '@aresrpg/sdk/jobs'

import { resource_visual } from './spawn_rigs.js'

const JOBS = /** @type {const} */ (['farmer', 'herbalist', 'miner'])

describe('resource_visual — (job, tier) → gatherable identity + family', () => {
  it('every job (0-2) × tier (1-11) resolves to the roster id at that tier (the procedural sprite key)', () => {
    JOBS.forEach((job_key, job) => {
      for (let tier = 1; tier <= 11; tier += 1) {
        const expected = GATHER_RESOURCES[job_key].find((r) => r.tier === tier)
        const v = resource_visual(job, tier)
        expect(v.id).toBe(expected.id) // the id keys synth_gather_buffer(id) → the procedural sprite
        expect(v.name).toBe(expected.name)
        expect(v.job_key).toBe(job_key)
      }
    })
  })

  it('family silhouette params key off the job (wheat tall+sway · herb short+mild · ore short+static+rock)', () => {
    const wheat = resource_visual(0, 1)
    const herb = resource_visual(1, 1)
    const ore = resource_visual(2, 1)
    expect(wheat.family).toBe('wheat')
    expect(herb.family).toBe('herb')
    expect(ore.family).toBe('ore')
    // wheat is the tallest + sways strongest; ore is static and the only family on a rock.
    expect(wheat.h).toBeGreaterThan(herb.h)
    expect(wheat.sway).toBeGreaterThan(herb.sway)
    expect(herb.sway).toBeGreaterThan(0)
    expect(ore.sway).toBe(0)
    expect(ore.rock).toBe(true)
    expect(wheat.rock).toBe(false)
    expect(herb.rock).toBe(false)
    // every family renders as a multi-card STAND (never a lone card — a single blade reads small/floating/alone).
    for (const v of [wheat, herb, ore]) expect(v.cards).toBeGreaterThanOrEqual(1)
    expect(wheat.cards).toBeGreaterThanOrEqual(herb.cards)
  })

  it('cluster height grows with tier — the apex node is grander than a tier-1 of the same family', () => {
    for (let job = 0; job <= 2; job += 1) {
      expect(resource_visual(job, 11).h).toBeGreaterThan(resource_visual(job, 1).h)
    }
  })

  it('the apex tier (T11) is the only one flagged for the sanctioned glow', () => {
    for (let job = 0; job <= 2; job += 1) {
      expect(resource_visual(job, 11).is_apex).toBe(true)
      for (let tier = 1; tier <= 10; tier += 1) expect(resource_visual(job, tier).is_apex).toBe(false)
    }
  })

  it('clamps out-of-range job/tier instead of crashing (defensive against a drifted chain row)', () => {
    expect(resource_visual(9, 99).id).toBeTruthy() // job>2, tier>11 → clamped to miner T11
    expect(resource_visual(9, 99).job_key).toBe('miner')
    expect(resource_visual(-1, 0).job_key).toBe('farmer') // job<0, tier<1 → clamped to farmer T1
    expect(resource_visual(-1, 0).id).toBe('wheat')
  })
})

// ── ID AUDIT: the 33-id GATHER_RESOURCES map vs a SEED-DERIVED fixture (the seed base_resources.json are the
// constitution per SPEC §12). A non-node id (e.g. cursed_amalgam — a rare DROP + craft
// reagent) must NEVER appear as a node identity. The fixture is read from the seed at test time, so it catches
// drift in either direction (a wrong tier id OR an id the seed doesn't back). ──────────────────────────────
describe('GATHER_RESOURCES id map ⇔ seed base_resources.json (the fixed node identities)', () => {
  const seed_dir = join(import.meta.dir, '../../../../seed/gathering')
  const seed_rows = (job) => JSON.parse(readFileSync(join(seed_dir, job, 'base_resources.json'), 'utf8'))
  // (job) → Map(tier → id), derived from each row's gatheringJson jobType+tier — the seed's own truth.
  const seed_by_tier = (job) => {
    const m = new Map()
    for (const row of seed_rows(job)) {
      const g = JSON.parse(row.gatheringJson)
      expect(g.jobType).toBe(job.toUpperCase()) // the file's rows really are this job's nodes
      m.set(g.tier, row.id)
    }
    return m
  }

  JOBS.forEach((job) => {
    it(`${job}: every tier 1-11 maps to the seed's node id at that (jobType, tier)`, () => {
      const seed = seed_by_tier(job)
      const roster = GATHER_RESOURCES[job]
      expect(roster).toHaveLength(11)
      for (let tier = 1; tier <= 11; tier += 1) {
        const entry = roster.find((r) => r.tier === tier)
        expect(entry, `${job} T${tier} missing from GATHER_RESOURCES`).toBeTruthy()
        expect(entry.id).toBe(seed.get(tier)) // map id === seed node identity at this tier
      }
      // set-equality both ways: no map id the seed doesn't back, no seed node the map drops.
      expect(new Set(roster.map((r) => r.id))).toEqual(new Set([...seed.values()]))
    })
  })

  it('no roster carries a non-node id — cursed_amalgam is a rare DROP/reagent, never a job resource', () => {
    const all_ids = new Set(JOBS.flatMap((job) => GATHER_RESOURCES[job].map((r) => r.id)))
    expect(all_ids.has('cursed_amalgam')).toBe(false)
    expect(all_ids.size).toBe(33) // 3 jobs × 11 tiers, all distinct
  })
})
