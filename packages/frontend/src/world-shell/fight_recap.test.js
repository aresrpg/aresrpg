// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D2: the victory card must still show the defeated enemy team — the recap payload now opens for
// BOTH outcomes off the session's OWN committed roster (fight_recap_payload, pure). The WIN rows here are the
// regression pin: the engine rewrite (8c3ec0c) had narrowed the recap-open to defeats, so FightResult.jsx's
// roster read (`recap.summary.participants`) came up empty on a win → the enemies section never rendered.
import { describe, expect, it } from 'bun:test'

import { fight_report_enemy_rows } from '../game/screens/hud/fight_report_roster.js'

import { fight_recap_payload } from './fight_recap.js'

const ME = '0xME'

/** The engine_view fighters Map shape (project.js): players team 0, mobs team 1. */
const fighters = (rows) => new Map(rows.map((f) => [f.id, f]))

// #1993 WP7 — the canonical entity rows captured beside the roster. The recap carries each seat's EXACT final
// HP from here; a recap taken WITHOUT them states liveness and draws no bar (the `null` arms pinned below).
const razkin_vitals = {
  'seat-0': { vitals: { committed: 31, max: 50 } },
  'mob-0': { vitals: { committed: 0, max: 40 } },
  'mob-1': { vitals: { committed: 0, max: 80 } },
}

const razkin_win = () =>
  fighters([
    { id: 'seat-0', name: 'hero', team: 0, level: 12, is_player: true, dead: false, owner: ME },
    // `variant` is the mob's on-chain TEMPLATE id (project.js: variant = view.mobs[].template) — the id the
    // encyclopedia bestiary routes on. Players carry none.
    // `identity_resolved` is the identity book's verdict, snapshotted beside the label so a terminal card knows
    // whether it is showing a real name or an id (#1993 WP3). These two resolved off the mob roster.
    // prettier-ignore
    { id: 'mob-0', name: 'Razkin', identity_resolved: true, team: 1, level: 8, is_player: false, dead: true, variant: '0xTPL_RAZKIN' },
    // prettier-ignore
    { id: 'mob-1', name: 'Razkin Alpha', identity_resolved: true, team: 1, level: 10, is_player: false, dead: true, variant: '0xTPL_ALPHA' },
  ])

describe('fight_recap_payload — a WIN carries the defeated enemy team (D2)', () => {
  it('winner 0 → won:true, the beaten mobs ride as DEAD enemy rows (the card renders DEFEATED off alive:false)', () => {
    const { summary, won } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0 })
    expect(won).toBe(true)
    expect(summary.winner).toBe(0)
    expect(summary.participants.filter((p) => p.team === 1)).toEqual([
      {
        id: 'mob-0',
        name: 'Razkin',
        label: 'Razkin',
        resolved: true,
        team: 1,
        level: 8,
        is_player: false,
        alive: false,
        final_hp: null,
        max_hp: null,
        template_id: '0xTPL_RAZKIN',
      },
      {
        id: 'mob-1',
        name: 'Razkin Alpha',
        label: 'Razkin Alpha',
        resolved: true,
        team: 1,
        level: 10,
        is_player: false,
        alive: false,
        final_hp: null,
        max_hp: null,
        template_id: '0xTPL_ALPHA',
      },
    ])
  })

  // The end-fight card's mob rows deep-link into the bestiary, so the recap — the ONE projection both cards
  // read — must carry the mob's TEMPLATE id. A fighter id ('mob-0') is a fight-scoped seat key, not an entity
  // identity: the card could not have built the link from it.
  it('a mob row carries its TEMPLATE id; a player row carries none (never a fabricated bestiary link)', () => {
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0 })
    expect(summary.participants.find((p) => p.id === 'mob-0')?.template_id).toBe('0xTPL_RAZKIN')
    expect(summary.participants.find((p) => p.id === 'seat-0')?.template_id).toBe(null)
  })

  it('the shared card adapter preserves the recap template id for both terminal cards (#1222)', () => {
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0 })
    expect(fight_report_enemy_rows(summary.participants, 0)).toEqual([
      {
        id: 'mob-0',
        name: 'Razkin',
        level: 8,
        is_player: false,
        alive: false,
        hp_pct: null,
        template_id: '0xTPL_RAZKIN',
      },
      {
        id: 'mob-1',
        name: 'Razkin Alpha',
        level: 10,
        is_player: false,
        alive: false,
        hp_pct: null,
        template_id: '0xTPL_ALPHA',
      },
    ])
  })

  // #1993 WP7 — the exact-vitals arm of the same projection. The `null` rows above are the no-vitals control:
  // together they pin that a bar is drawn from real final HP or not at all, and never fabricated from liveness.
  it('with the entity rows captured, the cards carry EXACT final vitals', () => {
    const { summary } = fight_recap_payload({
      fighters: razkin_win(),
      vitals: razkin_vitals,
      my_addr: ME,
      winner: 0,
    })
    expect(summary.participants.find((p) => p.id === 'seat-0')).toMatchObject({ final_hp: 31, max_hp: 50 })
    expect(fight_report_enemy_rows(summary.participants, 0).map((row) => row.hp_pct)).toEqual([0, 0])
  })

  it('on a WIN the local player keeps the core liveness — alive when alive, honestly dead when carried', () => {
    const alive = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0 })
    expect(alive.summary.participants.find((p) => p.id === 'seat-0')?.alive).toBe(true)
    const carried = fight_recap_payload({
      fighters: fighters([
        { id: 'seat-0', name: 'hero', team: 0, level: 12, is_player: true, dead: true, owner: ME },
        { id: 'seat-1', name: 'ally', team: 0, level: 14, is_player: true, dead: false, owner: '0xALLY' },
        { id: 'mob-0', name: 'Razkin', team: 1, level: 8, is_player: false, dead: true },
      ]),
      my_addr: ME,
      winner: 0,
    })
    expect(carried.summary.participants.find((p) => p.id === 'seat-0')?.alive).toBe(false)
  })

  it('a DEFEAT keeps the pre-split behavior verbatim: the local player is FORCED fallen even when the core still says alive', () => {
    const { summary, won } = fight_recap_payload({
      fighters: fighters([
        { id: 'seat-0', name: 'hero', team: 0, level: 12, is_player: true, dead: false, owner: ME }, // escrow race: not yet dead in the view
        { id: 'mob-0', name: 'Razkin', team: 1, level: 8, is_player: false, dead: false },
      ]),
      my_addr: ME,
      winner: 1,
      xp: 40,
    })
    expect(won).toBe(false)
    expect(summary.participants.find((p) => p.id === 'seat-0')?.alive).toBe(false) // forced fallen
    expect(summary.participants.find((p) => p.id === 'mob-0')?.alive).toBe(true) // enemies honest
    expect(summary.xp).toBe(40) // the defeat consolation pool rides through
  })

  it('a torn view (fighters null — teardown raced) degrades to an EMPTY roster, never a throw', () => {
    const { summary, won } = fight_recap_payload({ fighters: null, my_addr: ME, winner: 0 })
    expect(won).toBe(true)
    expect(summary.participants).toEqual([])
  })
})

// RED-FIRST (victory-card overhaul — the fight duration must be shown): duration_ms was
// hardcoded 0 regardless of input (no timestamp source was ever threaded through). This pins the passthrough
// contract for the lane that wires a real fight-start timestamp into dungeon_run_store.js's open_fight_recap.
describe('fight_recap_payload — duration_ms passthrough', () => {
  it('threads a caller-supplied duration_ms straight onto the summary', () => {
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0, duration_ms: 154000 })
    expect(summary.duration_ms).toBe(154000)
  })

  it('no duration_ms supplied → 0 (honest "no timestamp source" — never a guessed number)', () => {
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0 })
    expect(summary.duration_ms).toBe(0)
  })
})

// recap-truth lane: dungeon_run_store.js now captures a REAL fight_started_at_ms at bind time (fresh
// mint/join → exact; resume/poll-adopt → a floor only) and threads duration_partial alongside duration_ms so
// the card can render "~2:34" instead of a false-precise "2:34" when this client only discovered an
// already-live fight.
describe('fight_recap_payload — duration_partial passthrough (fresh vs late-observed fight-start)', () => {
  it('threads a caller-supplied duration_partial straight onto the summary', () => {
    const { summary } = fight_recap_payload({
      fighters: razkin_win(),
      my_addr: ME,
      winner: 0,
      duration_ms: 45000,
      duration_partial: true,
    })
    expect(summary.duration_partial).toBe(true)
  })

  it('no duration_partial supplied → false (the common fresh-start case, never an accidental "~")', () => {
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0, duration_ms: 45000 })
    expect(summary.duration_partial).toBe(false)
  })
})
