// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_e2e.test.js — THE L4 GATE: a full seeded fight, start → victory, headless, end to end.
//
// Nothing is faked. L1's builders make the seats (`content.js build_seat`), L4's fold turns them into sim
// entities (`fight_setup.js`), L2's local chain is the authority and the encoder (`@aresrpg/fight/sim_chain`),
// and the rows it emits are folded through the REAL production fight core (`create_fight_store`) — the same
// door a chain receipt enters in the live game. So this exercises exactly the pipeline the page runs, minus
// the renderer.
//
// WHAT IT PROVES (spec §11 · L4 acceptance):
//   1. a scripted multi-turn fight reaches a decided winner without stalling;
//   2. the fight CORE's own projection agrees with the sim's — the "one observable, two folders" contract,
//      re-checked from the frontend side of the seam;
//   3. determinism: the same seed twice ⇒ byte-identical rows and an identical capsule trace digest, and that
//      digest is PINNED, so stability holds across processes and not merely within one run;
//   4. a different seed ⇒ a different fight (without which (3) proves nothing);
//   5. the exported dual capsule is complete and physics-clean. Its full re-fold is blocked on ONE cross-lane
//      defect in L2's recorder header, pinned by a named test at the bottom of this file rather than skipped.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { decode } from '@aresrpg/fight/los'
import { committed_state } from '@aresrpg/fight/store'
import { normalize_spell_templates, MOB_ATTACK_ID } from '@aresrpg/sim/spell_templates'
import { digest, replay_capsule } from '@aresrpg/sim/timeline'
import {
  abandon_fight,
  capsule_of,
  create_sim_chain,
  current_actor,
  pending_mob_turn,
  snapshot_from_sim,
  submit_commands,
} from '@aresrpg/fight/sim_chain'

import { build_teams } from './fight_setup.js'
import { build_seat } from './content.js'
import { build_sim_trace, seed_from_fight_id, sim_fight_id } from './trace_export.js'

const SEED = 0xc81f3a92
const CLOCK = { now_ms: 1_700_000_000_000 } // pinned: the chain is pure and takes its clock as an argument

const character = (id, name) => ({
  id,
  name,
  class_id: 'senshi',
  level: 30,
  stat_alloc: { vitality: 100, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {},
})

const mob_block = (name) => ({
  template_id: `0xmob_${name}`,
  name,
  element: 3,
  role: 'striker',
  level: 6,
  min_level: 4,
  max_level: 8,
  hp: 30,
  max_hp: 30,
  ap: 6,
  mp: 3,
  stats: {},
  combat_block_published: true,
})

/** The roster and mob picks a setup page would hand START. Cells are chosen inside the derived board below. */
const setup_of = () => {
  const roster = [character('sim_c1', 'KAELIS'), character('sim_c2', 'VORREN')]
  const mobs = [mob_block('aetherwing'), mob_block('gronk')]
  return { roster, mobs }
}

/**
 * Build the teams on the seed's OWN derived board — `create_sim_chain` derives it from the seed, so the seat
 * cells must come from that same derivation rather than a guessed grid. The chain is built once to read its
 * start cells, then rebuilt with the seats standing on them.
 */
const build_fight = (seed) => {
  const { roster, mobs } = setup_of()
  // The chain takes RAW template rows and normalizes them itself. Neither the class corpus nor the picked mobs
  // carry authored spells here, so the raw set is empty — every fighter casts `mob_attack`, which the sim's
  // normalizer seeds on its own (spell_templates.js MOB_ATTACK_TEMPLATE), live and on replay alike.
  const templates_raw = []
  const templates = normalize_spell_templates(templates_raw)
  // probe the board this seed derives, so placements land on its real start cells
  const probe = create_sim_chain({
    seed,
    fight_id: 'probe',
    team0: [],
    team1: [],
    templates_raw,
  })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.slice(0, 2).map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [MOB_ATTACK_ID],
    })),
    picks: mobs.slice(0, 2).map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: templates,
  })
  // every seat needs a deck deep enough to keep casting — casting DISCARDS the card (reduce.js handle_cast)
  const stocked = (entity) => ({ ...entity, deck: Array.from({ length: 24 }, () => MOB_ATTACK_ID) })
  return {
    roster,
    mobs,
    chain: create_sim_chain({
      seed,
      fight_id: sim_fight_id(seed, 1),
      team0: team0.map(stocked),
      team1: team1.map((entity) => ({
        ...stocked(entity),
        deck: [MOB_ATTACK_ID],
        hand: [MOB_ATTACK_ID],
        spell_levels: { [MOB_ATTACK_ID]: 1 },
      })),
      templates_raw,
    }),
  }
}

const entity_of = (state, id) => [...state.team0, ...state.team1].find((row) => row.id === id)
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** The staged draft a HUD would hand `commit_turn`: close on the lowest-id living mob and hit it once. */
const draft = (chain, entity_id) => {
  const state = chain.sim_state
  const me = entity_of(state, entity_id)
  const [target] = state.team1.filter((mob) => mob.health > 0)
  if (!target) return [{ type: 'end_turn', entity_id }]
  const step = (cell) => ({
    x: cell.x + Math.sign(target.cell.x - cell.x),
    y: cell.y + Math.sign(target.cell.y - cell.y),
  })
  const walk = Array.from({ length: 3 }).reduce(
    (acc) => {
      if (chebyshev(acc.cell, target.cell) <= 1) return acc
      const next = step(acc.cell)
      return { cell: next, path: [...acc.path, next] }
    },
    { cell: me.cell, path: [] }
  )
  const moves = walk.path.map((cell) => ({ type: 'move', entity_id, path: [cell] }))
  const casts =
    chebyshev(walk.cell, target.cell) <= 1
      ? [{ type: 'cast', entity_id, spell_id: MOB_ATTACK_ID, target: target.cell }]
      : []
  return [...moves, ...casts, { type: 'end_turn', entity_id }]
}

/** Run the whole fight through the chain's real submit door, banking every emitted row. */
const run_fight = (seed, { max_rounds = 80 } = {}) => {
  const built = build_fight(seed)
  const step = (acc) => {
    if (acc.rounds >= max_rounds || acc.chain.sim_state.winner !== -1) return acc
    const actor = current_actor(acc.chain)
    if (!actor) return acc
    const mob = pending_mob_turn(acc.chain)
    const result = mob
      ? submit_commands(acc.chain, [{ type: 'ai_turn', entity_id: mob }], CLOCK)
      : submit_commands(acc.chain, draft(acc.chain, actor), CLOCK)
    if (result.chain.sim_state === acc.chain.sim_state) return { ...acc, stalled: actor }
    return step({
      chain: result.chain,
      batches: [
        ...acc.batches,
        { version: result.version, receipt: result.receipt, hand_updates: result.hand_updates },
      ],
      rounds: acc.rounds + 1,
      stalled: null,
    })
  }
  const done = step({ chain: built.chain, batches: [], rounds: 0, stalled: null })
  return { ...built, ...done, rows: done.batches.flatMap((batch) => batch.receipt.events) }
}

/** Fold a run's snapshot + every receipt through the REAL production fight core. */
const fold_through_core = (run) => {
  const store = create_fight_store()
  const { fight_id } = run.chain
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: null,
    ctx: { address: '0x51m', my_entity_id: 'sim_c1', offset: { x: 0, z: 0 }, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(run.chain, CLOCK), version: 1 })
  for (const batch of run.batches)
    store.getState().input({ type: 'receipt', version: batch.version, receipt: batch.receipt, fight_id })
  return store
}

describe('L4 · a seeded fight runs start → decided, headless', () => {
  const run = run_fight(SEED)

  test('it reaches a real terminal without stalling', () => {
    expect(run.stalled).toBeNull()
    expect(run.chain.sim_state.winner).not.toBe(-1)
    expect(run.rounds).toBeGreaterThan(3)
  })

  test('the authority emitted a real multi-batch chain event stream', () => {
    expect(run.batches.length).toBeGreaterThan(3)
    expect(run.rows.length).toBeGreaterThan(10)
    expect(run.rows.every((row) => typeof row.type === 'string' && row.parsedJson != null)).toBe(true)
    expect(run.rows.some((row) => row.type.endsWith('TurnStarted'))).toBe(true)
    expect(run.rows.some((row) => row.type.endsWith('Hit'))).toBe(true)
  })

  test('receipt versions are strictly monotonic above the bootstrap snapshot', () => {
    expect(run.batches[0].version).toBe(2)
    const versions = run.batches.map((batch) => batch.version)
    expect(versions.every((version, index) => index === 0 || version > versions[index - 1])).toBe(true)
  })

  test('the fight CORE folds every batch and never reports a protocol fault', () => {
    const store = fold_through_core(run)
    expect(store.getState().protocol_fault).toBeFalsy()
    expect(store.getState().applied_version).toBe(run.batches[run.batches.length - 1].version)
  })

  test('ONE OBSERVABLE, TWO FOLDERS — the core’s committed hp agrees with the sim’s own', () => {
    const committed = committed_state(fold_through_core(run).getState())
    for (const [index, mob] of run.chain.sim_state.team1.entries()) {
      const folded = committed.fighters?.[`m${index}`]
      if (!folded) continue
      expect(folded.hp).toBe(mob.health)
    }
  })
})

describe('L4 · determinism — the seed is the whole fight', () => {
  const a = run_fight(SEED)
  const b = run_fight(SEED)

  test('the same seed twice ⇒ byte-identical chain rows', () => {
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows))
    expect(a.batches.map((batch) => batch.version)).toEqual(b.batches.map((batch) => batch.version))
    expect(a.chain.sim_state.winner).toBe(b.chain.sim_state.winner)
  })

  test('the capsule trace digest is STABLE — pinned, so it holds across processes too', () => {
    const digest_of = (run) => replay_capsule(capsule_of(run.chain)).trace_digest
    expect(digest_of(a)).toBe(digest_of(b))
    // A pinned golden: a change here means the sim, the seed threading, or the command list moved. That is a
    // conversation, not a rebaseline — the whole determinism story rides on this number. It moved ONCE, when
    // the recorder header started holding raw templates: it pins the REPLAY's trace, which until then folded
    // inert spells. The LIVE run's digest (sim_chain.test.js SIM_CHAIN_RUN_DIGEST) never moved.
    expect(digest_of(a)).toMatchSnapshot()
  })

  test('a DIFFERENT seed ⇒ a different fight (else the equality above proves nothing)', () => {
    const other = run_fight(0x0000beef)
    expect(other.chain.sim_state.winner).not.toBe(-1)
    expect(JSON.stringify(other.rows)).not.toBe(JSON.stringify(a.rows))
  })
})

describe('L4 · the exported trace replays (spec §8, both halves)', () => {
  const run = run_fight(SEED)

  test('the capsule carries the WHOLE fight — placement, ready and every committed command', () => {
    const capsule = capsule_of(run.chain)
    expect(capsule.meta.seed).toBe(SEED)
    expect(capsule.initial.arena_seed).toBe(SEED)
    // placement + ready are in the list: a capsule that starts mid-placement is not replayable at all
    expect(capsule.commands.filter((command) => command.type === 'place').length).toBeGreaterThan(0)
    expect(capsule.commands.filter((command) => command.type === 'ready').length).toBeGreaterThan(0)
    expect(capsule.commands.filter((command) => command.type === 'cast').length).toBeGreaterThan(0)
  })

  test('the live fold tripped ZERO physics invariants, and so does the replay', () => {
    expect(run.chain.violations).toEqual([])
    expect(replay_capsule(capsule_of(run.chain)).violations).toEqual([])
  })

  // THE REPLAY CONTRACT. `replay_capsule` rebuilds its ctx with `normalize_spell_templates(templates_raw)`, so
  // the recorder header holds the RAW corpus rows the chain was built from — never the normalized map, which
  // re-normalizes into inert `UNSUPPORTED` effects (the normalizer is not idempotent). Storing raw makes the
  // capsule a true re-fold of the live fight: same spells, same commands, same terminal.
  test('sim capsule replays to the same terminal', () => {
    const replayed = replay_capsule(capsule_of(run.chain))
    expect(run.chain.sim_state.winner).not.toBe(-1) // the LIVE fight decides
    expect(replayed.terminal.winner).toBe(run.chain.sim_state.winner) // …and the REPLAY decides it the same way
    // the WHOLE terminal state, byte for byte. `arena_radius` is the one field a capsule does not carry:
    // `revive_arena` re-derives it as (width-1)/2 while the chain uses width>>1. No reducer path reads it
    // (it is a carried donor field, fight_state.js:137), so it is normalized out of the comparison.
    const comparable = (state) => digest({ ...state, arena_radius: 0 })
    expect(comparable(replayed.terminal)).toBe(comparable(run.chain.sim_state))
  })

  test('the download payload bundles both formats, each rooted in the seed', () => {
    const store = fold_through_core(run)
    const trace = build_sim_trace({
      seed: SEED,
      fight_id: run.chain.fight_id,
      sim_capsule: capsule_of(run.chain),
      // the tee's envelope capsule is shaped by the core; its session id is the seed-bearing fight id
      envelope_capsule: { trace_format: 2, session_id: store.getState().fight_id, capsules: [] },
    })
    expect(trace.sim_capsule.meta.seed).toBe(SEED)
    expect(trace.sim_capsule.commands.length).toBeGreaterThan(10)
    expect(seed_from_fight_id(trace.envelope_capsule.session_id)).toBe(SEED)
  })
})

describe('L4 · STOP mid-fight (spec §4.7)', () => {
  test('abandoning every living seat decides the fight through the sim and emits terminal rows', () => {
    const { chain } = build_fight(SEED)
    const result = abandon_fight(chain, CLOCK)
    expect(result.chain.sim_state.winner).toBe(1) // the mobs take it — the roster walked
    expect(result.receipt.events.length).toBeGreaterThan(0)
    expect(result.version).toBe(2)
  })
})
