// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W4 — THE WORLD-JOURNEY headless scenario (D770a): the world twin of the fight core's solo-lifecycle harness.
// ONE atomic create+join → spawn → search → claim walk across ALL THREE cores driven by plain-object inputs — session_gate
// (which session is live), spawns_zones (where I am proven + what is claimable), presence (who is around) —
// with cross-domain facts crossing ONLY as typed inputs ferried by a tiny composition root (cores never import
// cores). The claim ends at the exact `fight_entry` seam the fight core's solo scenario picks up, and a
// two-actor presence rider proves the overlay: actor A sees actor B roam, and actor B sees A's fresh fight as a
// joinable marker. Every assertion is on core OUTPUTS / projections / beats — zero browser, zero transport.

import { describe, expect, it } from 'bun:test'

import { create_session_gate_store, plan_scene } from '../src/session_gate.js'
import {
  create_spawns_store,
  boot_spawn,
  spawn_rows,
  attack_target,
  affordance_rows,
  subscribe_spawn_tx,
  subscribe_spawn_beats,
  subscribe_fight_entry,
} from '../src/spawns_zones.js'
import { create_presence_store, visible_players, see_fights_count } from '../src/presence.js'
import { to_fight_marker, is_join_legal } from '../src/nearby_fights.js'

const WORLD = `0x${'a'.repeat(64)}`
const ALICE = `0x${'1'.repeat(64)}`
const BOB = `0x${'2'.repeat(64)}`
const TMPL = `0x${'b'.repeat(64)}`
const ALICE_FIGHT = `0x${'f'.repeat(64)}`
const NOW = 1_000
// A 100×100-zone world, bounds 1000 → offset 500: chain (500,500) = world (0,0); chain (520,540) = world (20,40).
const DOC = { zone_size: 100, bounds_x: 1000, bounds_z: 1000, zone_ttl_ms: 60_000 }
const mob = (spawn_id, x, z) => ({ spawn_id, kind: 'mob', x, z, template_id: TMPL, size: 3 })

// THE COMPOSITION ROOT (the GameWorldHost/embed_voxel adapter, distilled): the three atoms + the ferry that
// carries one core's OUTPUT into another's door as a typed input. No core ever reads another core.
function world() {
  const session = create_session_gate_store()
  const spawns = create_spawns_store()
  const presence = create_presence_store()
  const s = (msg) => session.getState().input(msg, NOW)
  const sp = (msg) => spawns.getState().input(msg, NOW)
  // THE FERRY: session_gate's bound-world OUTPUT → spawns.world_bound (a world change is a RESET input, not a
  // shared reference) + presence.session — the exact seam the note fixes, dispatched, never a cross-import.
  const ferry_bound_world = () => {
    const { character_id, world: bound } = session.getState()
    if (typeof bound !== 'string') return
    spawns.getState().input({ type: 'world_bound', world_id: bound }, NOW)
    presence.getState().input({ type: 'session', character_id }, NOW)
  }
  return { session, spawns, presence, s, sp, ferry_bound_world }
}

describe('W4 — the world journey: atomic membership → spawn → search → claim → fight handoff', () => {
  it('walks the full solo lifecycle across the three cores, ending at the fight_entry seam', () => {
    const w = world()
    const view = () =>
      plan_scene({ show_world: true, authenticated: true, on_world_tab: true, ...w.session.getState() })

    // ── ATOMIC CREATE+JOIN — the settled receipt publishes its already-committed membership ──
    w.s({ type: 'binding_published', character_id: ALICE, world: WORLD, source: 'manual' })
    expect(view()).toEqual({ action: 'resident', key: `lobby:${ALICE}:${WORLD}` }) // BOUND → the resident session

    // FERRY the bound world into the spawns + presence doors (the composition root's job, not a cross-import).
    w.ferry_bound_world()
    w.sp({ type: 'world_doc', doc: DOC })
    expect(w.spawns.getState().world_id).toBe(WORLD)

    // ── SPAWN — a chain-direct checkpoint read resolves boot_spawn to {source:'checkpoint'} ──
    w.sp({
      type: 'checkpoint_resolved',
      world_id: WORLD,
      x: 520,
      z: 540,
      source: 'read',
      world_position: { x: 20, z: 40, time_ms: 1_000, speed_budget: 1150 },
    })
    const spawn = boot_spawn(
      w.spawns.getState(),
      { session: { x: 900, z: 900, y: 10 }, fallback: [0, 80, 0], y_seed: 80 },
      11_000 // 10s of travel budget = 115 blocks — the ~1200-block restore is one the chain would refuse
    )
    expect(spawn).toMatchObject({ source: 'checkpoint', position: [20, 80, 40] }) // chain wins over the far restore

    // ── SEARCH — intent emits search_tx + a progress beat; the receipt discovers the zone + reveal beats ──
    const tx = []
    const beats = []
    subscribe_spawn_tx(w.spawns, (r) => tx.push(r))
    subscribe_spawn_beats(w.spawns, (b) => beats.push(b.kind))
    w.sp({ type: 'player_pos', x: 30, z: 45 })
    w.sp({ type: 'search_intent', x: 30, z: 45 })
    expect(tx.at(-1)).toMatchObject({ kind: 'search', payload: { world_id: WORLD, zx: 5, zy: 5 } })
    expect(beats).toEqual(['search_progress'])
    // the RECEIPT: checkpoint + zone + hunt_zone advance atomically; the reveal beats fire; the paired rows land.
    w.sp({ type: 'zone_searched', zx: 5, zy: 5, x: 30, z: 45, found: { mob_groups: 1, resource_nodes: 0 } })
    w.sp({ type: 'zone_rows', zx: 5, zy: 5, proven: true, rows: [mob('7', 520, 540)] })
    expect(w.spawns.getState().checkpoint).toEqual({ x: 30, z: 45 }) // the search PROVED this standing position
    expect(w.spawns.getState().hunt_zone).toEqual({ zx: 5, zy: 5 })
    expect(beats).toEqual(['search_progress', 'reveal_chime', 'reveal_banner', 'fov_pulse'])
    expect(spawn_rows(w.spawns.getState()).map((r) => r.key)).toEqual(['5:5:mob:7'])

    // a LATE, lagging poll (pre-search indexer state) converges as a NO-OP — receipt-proven facts survive the grace.
    const before = spawn_rows(w.spawns.getState())
    w.sp({ type: 'zones_rows_snapshot', version: 1, zones: [], cells: [] })
    expect(spawn_rows(w.spawns.getState())).toEqual(before)

    // ── CLAIM — proximity arms [R]; the intent emits claim_tx; the receipt removes the group + hands off ──
    w.sp({ type: 'player_pos', x: 21, z: 41 }) // ~1.4 blocks from the mob world anchor (20, 40)
    expect(attack_target(w.spawns.getState())?.key).toBe('5:5:mob:7') // ARMING IS FOLD STATE — the renderer decides nothing
    expect(affordance_rows(w.spawns.getState(), NOW).map((r) => r.id)).toContain('attack')
    const entries = []
    subscribe_fight_entry(w.spawns, (e) => entries.push(e.fight_id))
    w.sp({ type: 'claim_intent', key: '5:5:mob:7' })
    expect(tx.at(-1)).toMatchObject({ kind: 'claim', payload: { spawn_id: '7', is_public: true } })
    expect(spawn_rows(w.spawns.getState()).find((r) => r.key === '5:5:mob:7')?.pending).toBe('claim') // optimistic hide
    w.sp({ type: 'claim_receipt', key: '5:5:mob:7', fight_id: ALICE_FIGHT })
    expect(spawn_rows(w.spawns.getState()).find((r) => r.key === '5:5:mob:7')).toBeUndefined() // REMOVED
    expect(w.spawns.getState().fight_entry).toMatchObject({ fight_id: ALICE_FIGHT }) // the SEAM the fight core picks up
    expect(entries).toEqual([ALICE_FIGHT]) // the effect edge saw the handoff exactly once
  })

  it('presence rider: actor A sees B roam, and actor B sees A’s fresh fight as a joinable marker', () => {
    // Actor A's presence atom: B's peer_pos folds in → A renders B as a visible player (the freshness-law'd overlay).
    const a = create_presence_store()
    a.getState().input({ type: 'session', character_id: ALICE }, NOW)
    a.getState().input({ type: 'peer_pos', id: BOB, x: 12, y: 8, h: 64 }, NOW)
    expect(visible_players(a.getState()).map((p) => p.id)).toEqual([BOB])

    // Actor B's presence atom: a fights snapshot carrying A's fresh fight (the one A just entered via claim) → B's
    // markers show it, in range, and it is JOIN-LEGAL (public + placement) — the discovery seam that lets B join A.
    const b = create_presence_store()
    b.getState().input({ type: 'session', character_id: BOB }, NOW)
    b.getState().input(
      {
        type: 'fights_snapshot',
        rows: [
          {
            fight_id: ALICE_FIGHT,
            anchor: { x: 510, z: 510 },
            public: true,
            status: 'placement',
            participants: [{ character: ALICE, seat: 0 }],
            mob_count: 3,
          },
        ],
        offset_x: 500,
        offset_z: 500,
        px: 0,
        pz: 0,
      },
      NOW
    )
    expect(see_fights_count(b.getState(), false)).toBe(1)
    const marker = b.getState().fight_markers.get(ALICE_FIGHT)
    expect(marker).toMatchObject({ position: { x: 10, z: 10 }, participant_ids: [ALICE] })
    expect(is_join_legal(marker)).toBe(true) // B can JOIN A's fresh fight (public + placement)
    // sanity: the raw shaper agrees on legality independent of the fold (one legality home)
    expect(is_join_legal(to_fight_marker({ fight_id: ALICE_FIGHT, public: true, status: 'placement' }))).toBe(true)
  })
})
