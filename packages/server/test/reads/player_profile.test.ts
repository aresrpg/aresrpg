// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'
import { job_slugs, job_xp_for_level } from '@aresrpg/immutable'

import { get_player_profile, get_profile_equipment } from '../../src/reads/get_player_profile.ts'
import { profile_jobs } from '../../src/reads/profile_jobs.ts'
import type { Graph, GraphRow } from '../../src/graph.ts'

const url = process.env.FALKOR_TEST_URL
const address = `0x${'a'.repeat(64)}`
const other = `0x${'b'.repeat(64)}`
const identity = (index: number): string => `0x${index.toString(16).padStart(64, '0')}`

test('profession presentation keeps all professions and uses the shared XP curve', () => {
  const jobs = profile_jobs({ MINER: job_xp_for_level(100), FARMER: job_xp_for_level(20) })
  expect(jobs).toHaveLength(job_slugs.length)
  expect(jobs.find(({ job }) => job === 'MINER')?.level).toBe(100)
  expect(jobs.find(({ job }) => job === 'FARMER')?.level).toBe(20)
  expect(jobs.find(({ job }) => job === 'BAKER')?.level).toBe(1)
})

test.skipIf(!url)(
  'indexed profiles page all holdings, aggregate unseen jobs, and qualify equipment by current owner',
  async () => {
    expect(url).toStartWith('redis://127.0.0.1:')
    const db = await FalkorDB.connect({ url })
    const store = db.selectGraph(`player_profile_${process.pid}_${Date.now()}`)
    const graph: Graph = {
      read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
      close: () => db.close(),
    }
    try {
      await store.query('CREATE INDEX FOR (c:Character) ON (c.owner)')
      await store.query('CREATE INDEX FOR (c:Character) ON (c.id)')
      const characters = Array.from({ length: 41 }, (_, index) => ({
        id: identity(index + 1),
        name: `Hero ${index + 1}`,
        classe: 'senshi',
        level: index + 1,
        owner: address,
        job_miner: index === 40 ? '18446744073709551615' : '0',
      }))
      await store.query('UNWIND $characters AS row CREATE (c:Character) SET c = row', { params: { characters } })
      await store.query('MATCH (c:Character {id: $id}) CREATE (:Fight)-[:FIGHTER]->(c)', {
        params: { id: identity(41) },
      })
      const first = await get_player_profile(graph, { kind: 'profile', address, after: null })
      expect(first.profile.characters).toHaveLength(20)
      expect(first.profile.character_count).toBe(41)
      expect(first.profile.next).toBe(identity(20))
      expect(first.profile.jobs.find(({ job }) => job === 'MINER')?.level).toBe(100)
      const second = await get_player_profile(graph, { kind: 'profile', address, after: first.profile.next })
      const last = await get_player_profile(graph, { kind: 'profile', address, after: second.profile.next })
      expect(last.profile.characters.map(({ id }) => id)).toEqual([identity(41)])
      expect(last.profile.next).toBeNull()
      expect(
        new Set(
          [...first.profile.characters, ...second.profile.characters, ...last.profile.characters].map(({ id }) => id)
        ).size
      ).toBe(41)
      const query = { kind: 'equipment' as const, address, character_id: identity(41) }
      expect(await get_profile_equipment(graph, query)).toEqual({ kind: 'equipment', equipment: [] })
      const stats = Array.from({ length: 15 }, () => 32768)
      stats[0] = 32788
      await store.query(
        `MATCH (c:Character {id: $id}) CREATE (c)-[:EQUIPS {slot: 'pet'}]->(:Item {id: 'pet', name: 'Pet', item_type: 'pet', category: 'pet', level: 1, amount: 1, stats: $stats, pet_power: 30})`,
        { params: { id: identity(41), stats } }
      )
      const worn = await get_profile_equipment(graph, query)
      expect(worn.equipment).toHaveLength(1)
      expect(worn.equipment![0]).toMatchObject({ slot: 'pet', pet_power: 30, stats: { vitality: 32788 } })
      expect(await get_profile_equipment(graph, { ...query, address: other })).toEqual({
        kind: 'equipment',
        equipment: null,
      })
      await store.query('MATCH (c:Character {id: $id}) SET c.owner = $owner', {
        params: { id: identity(41), owner: other },
      })
      expect(await get_profile_equipment(graph, query)).toEqual({ kind: 'equipment', equipment: null })
      const old_owner = await get_player_profile(graph, { kind: 'profile', address, after: null })
      expect(old_owner.profile.character_count).toBe(40)
      expect(old_owner.profile.jobs.find(({ job }) => job === 'MINER')?.level).toBe(1)
      const empty = await get_player_profile(graph, { kind: 'profile', address: identity(999), after: null })
      expect(empty.profile).toEqual({ characters: [], character_count: 0, jobs: [], next: null })
    } finally {
      await store.delete()
      await db.close()
    }
  }
)
