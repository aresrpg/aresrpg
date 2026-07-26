// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FORMAT-3 PIPELINE, END TO END (#1110/#1111) — `derive_zone` is what the overworld map draws from, so it,
// not just the kernel, has to agree with the chain. The fixture is shared with the Move suite
// (`aresrpg::spawn_ruled_model_tests`), which asserts the SAME rows through `zone_comp::derive_mobs_members`:
// one set of numbers, neither twin checking itself.
//
// Two properties only the full pipeline can show, because both live in the INPUTS the kernel is handed rather
// than in the kernel itself: the level cap is gone from the pick table (the whole roster shows up at the spawn
// box), and `progress` — the value the engine draws member levels at — comes back with the rows.
import { describe, test, expect } from 'bun:test'

import { derive_zone, commitment_format } from '../src/zone_derive.js'

import fixture from './fixtures/zone_members_pipeline_parity.json'

const MEMBERS_ROOT = [3, ...Array(32).fill(0)] // `0x03 ‖ digest` — only the format byte is read here
const LEGACY_ROOT = Array(32).fill(0) // a bare 32-byte root: format 1

const derive = (zx, zy, group_root = MEMBERS_ROOT) =>
  derive_zone({
    zone: {
      seed: BigInt(fixture.zone.seed),
      discovered_at_ms: fixture.zone.discovered_at_ms,
      mob_bitmap: [],
      res_bitmap: [],
      group_root,
    },
    zx,
    zy,
    world: fixture.world,
    team_bound: 6,
  }).filter(r => r.kind === 'mob')

describe('derive_zone ↔ zone_comp member-list pipeline parity (format 3)', () => {
  test('the format byte routes the pipeline', () => {
    expect(commitment_format(MEMBERS_ROOT)).toBe(3)
    expect(commitment_format(LEGACY_ROOT)).toBe(1)
  })

  for (const ring of ['near', 'far']) {
    const { zx, zy, progress, groups } = fixture[ring]
    test(`${ring} ring (progress ${progress}) — every row matches the Move pipeline`, () => {
      const rows = derive(zx, zy)
      expect(
        rows.map(r => ({
          spawn_id: r.spawn_id,
          x: r.x,
          z: r.z,
          size: r.size,
          members: r.members,
          group_seed: r.group_seed,
        })),
      ).toEqual(groups)
      // `progress` rides every row because the claim ticket carries it into the engine's graded level draw —
      // without it the client would predict a pack at the wrong difficulty and reconcile into a different fight
      for (const r of rows) expect(r.progress).toBe(progress)
    })
  }

  test('THE SUBSTITUTION — the whole roster shows up at the spawn box, and the roster is the seated one', () => {
    const rows = derive(fixture.near.zx, fixture.near.zy)
    const seen = new Set(rows.flatMap(r => r.members))
    // under the legacy level cap this zone admitted only the level-3 chicklet — the monoculture the ruling kills
    expect(seen.has('0xc1')).toBe(true)
    expect(seen.has('0xc2')).toBe(true)
    // the roster is trimmed to what actually seats: the stream derives 4 members, the §4 size cap seats 2
    for (const r of rows) expect(r.members).toHaveLength(r.size)
    // and it genuinely mixes — a pipeline that lost the member draw would show every pack single-spec
    expect(rows.some(r => new Set(r.members).size > 1)).toBe(true)
  })

  test('THE BOSS FENCE survives the pipeline — the masked row never rides along', () => {
    const rows = [
      ...derive(fixture.near.zx, fixture.near.zy),
      ...derive(fixture.far.zx, fixture.far.zy),
    ]
    // row 2 (`0xc3`) is the world's boss_mask entry: it may be a pack's primary, and then the pack is single-spec
    for (const r of rows)
      if (r.members.includes('0xc3'))
        expect(new Set(r.members).size).toBe(1)
  })

  test('a LEGACY zone is untouched by any of it — same doc, the level-capped monoculture', () => {
    const rows = derive(fixture.near.zx, fixture.near.zy, LEGACY_ROOT)
    // the level cap is back (only the level-3 row is eligible at the spawn box) and no roster rides the rows
    expect(new Set(rows.map(r => r.template_id))).toEqual(new Set(['0xc1']))
    for (const r of rows) {
      expect(r.members).toBeUndefined()
      expect(r.progress).toBeUndefined()
    }
  })
})
