// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain.test.js — THE DRIFT GATE for the simulator's local mock chain (simulator rebuild spec §4.4).
//
// "ONE OBSERVABLE, TWO FOLDERS" (v2/fold.js header) applied to the mock: the sim reducer folds commands into a
// FightState; the fight core folds the encoder's rows into a committed state. Both project the SAME observable
// — cell / hp / alive / active / winner per fighter. The gate asserts they are EQUAL at every batch boundary
// of a scripted multi-turn fight. That equality is the mechanical proof the mock cannot drift; nothing else in
// this lane is load-bearing without it.
//
// The fold side runs the REAL production path end to end, never a shortcut:
//   snapshot → board_state_from_fight → base_from_view → normalize_events (→ the SDK's decode_fight_event)
//   → apply_action
//
// This gate proves the encoder says the right THINGS. It cannot prove it says them in the chain's own DIALECT
// — `decode_fight_event` coerces that difference away before the fold sees it — so the codec half lives in
// `sim_chain_wire.test.js`, pinned against the captured corpus (docs/CODE_LAW.md's captured-wire-bytes law).
//
// KNOWN SPEC AMBIGUITIES, resolved here and reported upward (see the lane return):
//  1. A HEAL has NO chain event at all (cast.move applies heals silently; only `Hit` carries an authoritative
//     hp). The spec's table maps heal-shaped ticks to `Granted`, but `Granted` moves an AP/MP POOL, never hp —
//     encoding a heal that way drifts the observable. This encoder rides `Hit` (authoritative `remaining_hp`,
//     `amount` = the heal) and `heal_folds_hp` pins it.
//  2. `Granted` is not a `fight_events.move` struct; it is the fold's own grant kind (inputs.js). The spec
//     mandates it for `ap_reserve_used`, so it is emitted under the mock package id like every other row.

import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'
import { normalize_spell_templates } from '@aresrpg/sim/spell_templates'
import { generate } from '@aresrpg/sim/board_gen'
import { digest, replay_capsule, terminal_summary } from '@aresrpg/sim/timeline'

import * as SE from '../../sim/src/spell_effect.js'
import { board_state_from_fight } from '../src/board_state.js'
import { base_budget, base_from_view } from '../src/fold.js'
import { apply_action, normalize_events, seat_resolver } from '../src/inputs.js'
import { encode } from '../src/los.js'
import {
  abandon_fight,
  arena_from_board,
  capsule_of,
  commands_from_staged,
  create_sim_chain,
  current_actor,
  derive_board,
  encode_sim_step,
  fold_projection,
  key_of,
  pending_mob_turn,
  run_ai_turn,
  sim_projection,
  snapshot_from_sim,
  submit_commands,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:c81f3a92:1'
const NOW = 1_784_752_468_344

// ╔════════════════ [ The scripted fight — synthesized kits, the real reducer ] ════════════════════════════ ]
// The kit is SYNTHESIZED (the combinatorial/entities.js idiom: one authored template per effect kind, built
// through the real `normalize_spell_templates`) so the corpus deterministically exercises every arm the spec
// names — AoE, displacement, DoT, trap, heal, death, victory — instead of hoping a shipped spell does.

const level = (effects, { ap_cost = 3, range_max = 14, free_cell = false } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

const PLAYER_KIT = [
  { id: 's_nuke', levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 26, target_filter: SE.TF_NOT_TEAM }])] },
  {
    id: 's_aoe',
    levels: [
      level([
        {
          kind: SE.K_DAMAGE,
          element: 0,
          value: 11,
          target_filter: SE.TF_NOT_TEAM,
          area_shape: SE.SHAPE_CIRCLE,
          area_size: 2,
        },
      ]),
    ],
  },
  { id: 's_push', levels: [level([{ kind: SE.K_PUSH, value: 2, target_filter: SE.TF_NOT_TEAM }], { ap_cost: 2 })] },
  {
    id: 's_dot',
    levels: [level([{ kind: SE.K_APPLY_DOT, element: 0, value: 6, turns: 4, target_filter: SE.TF_NOT_TEAM }])],
  },
  {
    id: 's_trap',
    levels: [
      level(
        [
          { kind: SE.K_PLACE_TRAP, area_shape: SE.SHAPE_CIRCLE, area_size: 3 },
          { kind: SE.K_DAMAGE, element: 0, value: 9, target_filter: SE.TF_NOT_TEAM },
        ],
        { ap_cost: 2, free_cell: true }
      ),
    ],
  },
  {
    id: 's_heal',
    levels: [level([{ kind: SE.K_HEAL, element: 0, value: 8, target_filter: SE.TF_NOT_ENEMY }], { ap_cost: 2 })],
  },
  {
    id: 's_jab',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 7, target_filter: SE.TF_NOT_TEAM }], { ap_cost: 1 })],
  },
]

const MOB_KIT = [
  {
    id: 'm_hit',
    levels: [level([{ kind: SE.K_DAMAGE, element: 0, value: 15, target_filter: SE.TF_NOT_TEAM }], { range_max: 7 })],
  },
]

/** The whole castable corpus, RAW — what the chain stores and hands the sim's normalizer (and the recorder). */
const TEMPLATES_RAW = [...PLAYER_KIT, ...MOB_KIT]

const fighter = (id, cell, is_player, { health, ap, mp, deck = [], level: lvl = 20, stats = {} }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: lvl,
  stats,
  effects: [],
  // A deck of EXACTLY the opening hand size: `handle_start` deals min(7, deck.length), so the hand holds the
  // whole kit every turn (a cast discards, `end_turn` reshuffles the discard back). Deterministic control.
  deck: [...deck],
  hand: is_player ? [] : [...deck],
  discard: [],
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

const PLAYER_DECK = PLAYER_KIT.map((s) => s.id)
const MOB_DECK = MOB_KIT.map((s) => s.id)

/** Two roster seats on the board's own team-A start cells, three mobs on team B. */
const build_chain = ({ seed = SEED, fight_id = FIGHT_ID } = {}) => {
  const { board } = derive_board(seed)
  const arena = arena_from_board(board)
  const team0 = arena.spawns_a
    .slice(0, 2)
    .map((cell, i) => fighter(`sim_c${i + 1}`, cell, true, { health: 120, ap: 8, mp: 4, deck: PLAYER_DECK }))
  const team1 = arena.spawns_b
    .slice(0, 3)
    .map((cell, i) => fighter(`mob_${i}`, cell, false, { health: 46, ap: 6, mp: 3, deck: MOB_DECK, level: 12 }))
  return create_sim_chain({ seed, fight_id, team0, team1, templates_raw: TEMPLATES_RAW, group_template: '0xgroup' })
}

const living = (state, team) => state[team].filter((e) => e.health > 0)

/** The scripted turn for a player seat: cast a rotating spell at the nearest living mob (or its own cell for
 *  the self-heal / trap), then step toward it. Pure over the state — no clock, no rng, no board assumptions. */
const player_staged = (state, entity_id, round) => {
  const me = state.team0.find((e) => e.id === entity_id)
  const mobs = living(state, 'team1')
  if (!me || mobs.length === 0) return []
  const nearest = mobs.reduce((best, m) =>
    Math.abs(m.cell.x - me.cell.x) + Math.abs(m.cell.y - me.cell.y) <
    Math.abs(best.cell.x - me.cell.x) + Math.abs(best.cell.y - me.cell.y)
      ? m
      : best
  )
  const rotation = ['s_nuke', 's_aoe', 's_dot', 's_push', 's_trap', 's_heal', 's_jab']
  const spell_id = rotation[round % rotation.length]
  const self_targeted = spell_id === 's_heal' || spell_id === 's_trap'
  const target = self_targeted ? me.cell : nearest.cell
  // One step toward the nearest mob, on the 4-connected axis with the larger gap (the sim rebuilds the
  // canonical route from the destination alone — handle_move's destination-only door).
  const dx = nearest.cell.x - me.cell.x
  const dy = nearest.cell.y - me.cell.y
  const step =
    Math.abs(dx) >= Math.abs(dy)
      ? { x: me.cell.x + Math.sign(dx), y: me.cell.y }
      : { x: me.cell.x, y: me.cell.y + Math.sign(dy) }
  return [
    { kind: 1, target: encode(target.x, target.y), spell_template_id: spell_id },
    ...(dx === 0 && dy === 0 ? [] : [{ kind: 0, target: encode(step.x, step.y) }]),
  ]
}

/** One scripted batch = the acting seat's whole turn (a player commit, or one `ai_turn`) — exactly the receipt
 *  granularity the store sees. Pure over the chain: no clock, no rng, no I/O. */
const next_batch = (chain, round) => {
  const actor = current_actor(chain)
  if (actor == null) return null
  const mob = pending_mob_turn(chain)
  return mob
    ? run_ai_turn(chain, mob, { now_ms: NOW })
    : submit_commands(chain, commands_from_staged(player_staged(chain.sim_state, actor, round), actor), { now_ms: NOW })
}

/**
 * Drive the whole scripted fight, banking each batch's receipt AND the sim's own observable at that boundary —
 * the LEFT half of the twin. The fold side re-derives the right half from the receipts alone.
 * @returns {{ chain: object, snapshot: object,
 *   batches: { version:number, receipt:object, sim: ReturnType<typeof sim_projection> }[] }}
 */
const drive = ({ seed = SEED, fight_id = FIGHT_ID, max_batches = 60 } = {}) => {
  const booted = build_chain({ seed, fight_id })
  const run = Array.from({ length: max_batches }).reduce(
    (acc, _unused, round) => {
      if (acc.done) return acc
      const result = next_batch(acc.chain, round)
      if (result == null) return { ...acc, done: true }
      return {
        done: false,
        chain: result.chain,
        batches: [
          ...acc.batches,
          { version: result.version, receipt: result.receipt, sim: sim_projection(result.chain.sim_state) },
        ],
      }
    },
    { chain: booted, batches: [], done: false }
  )
  return { snapshot: snapshot_from_sim(booted, { now_ms: NOW }), chain: run.chain, batches: run.batches }
}

// ╔════════════════ [ The fold side — the production path, verbatim ] ═════════════════════════════════════ ]

const view_of = (snapshot) => board_state_from_fight({ fight: snapshot, version: 1 })

/** Fold a batch's receipt into a committed state through the REAL normalize→decode→apply_action door. */
const fold_receipt = (state, receipt, version, view) =>
  normalize_events(receipt, {
    version,
    fight_id: view.id,
    resolve_seat: seat_resolver(view),
    base_of: base_budget(view),
  }).reduce(apply_action, state)

/** The whole run folded: snapshot base + every batch, projected at each boundary. */
const fold_run = (snapshot, batches, { encode_rows = (r) => r } = {}) => {
  const view = view_of(snapshot)
  return batches.reduce(
    (acc, batch) => {
      const state = fold_receipt(acc.state, { events: encode_rows(batch.receipt.events) }, batch.version, view)
      return { state, boundaries: [...acc.boundaries, fold_projection(state)] }
    },
    { state: base_from_view(view, snapshot.id), boundaries: [] }
  )
}

// ╔════════════════ [ Board derivation ] ══════════════════════════════════════════════════════════════════ ]

describe('board derivation — the chain twin, seed-rooted', () => {
  test('derive_board reproduces board_gen exactly and is a pure function of (seed, anchor)', () => {
    const a = derive_board(SEED)
    const b = derive_board(SEED)
    expect(a).toEqual(b)
    expect(a.board).toEqual(generate(a.board_seed, 0))
    // an independently rerolled anchor (spec §9 flow 4) re-derives the board without touching the seed
    const moved = derive_board(SEED, { anchor_x: a.anchor_x + 1 })
    expect(moved.board_seed).not.toBe(a.board_seed)
    expect(moved.seed).toBe(a.seed)
  })

  test('arena_from_board blocks exactly the off-mask, obstacle and hole cells; spawns decode stride-20', () => {
    const { board } = derive_board(SEED)
    const arena = arena_from_board(board)
    expect(arena.width).toBe(board.width)
    expect(arena.height).toBe(board.height)
    const blocked = new Set([...board.obstacles, ...board.holes])
    const on_mask = (cell) => {
      const word = board.shape_mask[Math.floor(cell / 64)] ?? 0n
      return ((BigInt(word) >> BigInt(cell % 64)) & 1n) === 1n
    }
    let walkable = 0
    for (let y = 0; y < board.height; y++)
      for (let x = 0; x < board.width; x++) {
        const cell = encode(x, y)
        const expected = on_mask(cell) && !blocked.has(cell) ? 0 : 1
        expect(arena.cells[y * board.width + x]).toBe(expected)
        walkable += expected === 0 ? 1 : 0
      }
    expect(walkable).toBeGreaterThan(20)
    expect(arena.spawns_a.map((c) => encode(c.x, c.y))).toEqual(board.start_cells_a)
    expect(arena.spawns_b.map((c) => encode(c.x, c.y))).toEqual(board.start_cells_b)
  })
})

// ╔════════════════ [ Snapshot bootstrap ] ════════════════════════════════════════════════════════════════ ]

describe('snapshot bootstrap — the decoded-Fight the core adopts', () => {
  test('base_from_view of the snapshot equals the sim projection at the fight start', () => {
    const chain = build_chain()
    const snapshot = snapshot_from_sim(chain, { now_ms: NOW })
    const view = view_of(snapshot)
    expect(view.status).toBe(1) // STATUS_ACTIVE — the door adopts it as a live fight
    expect(fold_projection(base_from_view(view, snapshot.id))).toEqual(sim_projection(chain.sim_state))
  })

  test('the snapshot carries the sim queue verbatim — never a re-replicated interleave', () => {
    const chain = build_chain()
    const snapshot = snapshot_from_sim(chain, { now_ms: NOW })
    expect(snapshot.queue).toEqual(
      chain.sim_state.turn_order.map((id) => ({
        is_mob: key_of(chain.sim_state, id).startsWith('m'),
        idx: Number(key_of(chain.sim_state, id).slice(1)),
      }))
    )
    expect(view_of(snapshot).turn_queue).toEqual(snapshot.queue)
  })
})

// ╔════════════════ [ THE DRIFT GATE ] ════════════════════════════════════════════════════════════════════ ]

describe('THE DRIFT GATE — one observable, two folders (spec §4.4)', () => {
  const run = drive()

  test('the scripted corpus actually exercises every arm the spec names', () => {
    const kinds = new Set(run.batches.flatMap((b) => b.receipt.events.map((e) => e.type.split('::').pop())))
    for (const required of ['TurnStarted', 'TurnEnded', 'Moved', 'MobMoved', 'Cast', 'Hit', 'Displaced'])
      expect([...kinds]).toContain(required)
    // a death and a terminal both landed
    expect([...kinds].some((k) => k === 'Victory' || k === 'Defeat')).toBe(true)
    expect(run.batches.length).toBeGreaterThan(6)
    const dead = [...run.chain.sim_state.team0, ...run.chain.sim_state.team1].filter((e) => e.health <= 0)
    expect(dead.length).toBeGreaterThan(0)
  })

  test('the encoder fold equals the sim projection at EVERY batch boundary', () => {
    const folded = fold_run(run.snapshot, run.batches).boundaries
    // asserted BATCH BY BATCH (not as one array compare) so a drift names the exact turn it entered on
    run.batches.forEach((batch, index) => {
      expect({ batch: index, ...folded[index] }).toEqual({ batch: index, ...batch.sim })
    })
    expect(folded.length).toBe(run.batches.length)
  })

  // RED-FIRST PROOF: the gate is only worth its line count if a WRONG encoding fails it. Each mutation below is
  // a plausible encoder bug; every one must break the twin equality. A mutation that passes means the gate is
  // asleep, and that is itself the failure this test reports.
  const MUTATIONS = {
    'hp re-derived instead of read from the post-state': (events) =>
      events.map((e) =>
        e.type.endsWith('::Hit')
          ? { ...e, parsedJson: { ...e.parsedJson, remaining_hp: String(Number(e.parsedJson.remaining_hp) + 1) } }
          : e
      ),
    'the move destination is the path START (the pre-move cell)': (events) =>
      events.map((e) =>
        e.type.endsWith('::Moved') || e.type.endsWith('::MobMoved')
          ? { ...e, parsedJson: { ...e.parsedJson, to_cell: String(Number(e.parsedJson.to_cell) + 1) } }
          : e
      ),
    'displacement dropped (the fold never learns the new cell)': (events) =>
      events.filter((e) => !e.type.endsWith('::Displaced')),
    'the turn boundary is dropped (active never advances)': (events) =>
      events.filter((e) => !e.type.endsWith('::TurnStarted')),
    'the terminal is dropped (the fight never ends)': (events) =>
      events.filter((e) => !e.type.endsWith('::Victory') && !e.type.endsWith('::Defeat')),
    'mob and player sides are swapped in the fighter key': (events) =>
      events.map((e) => {
        const json = { ...e.parsedJson }
        for (const key of ['is_mob', 'victim_is_mob', 'caster_is_mob', 'target_is_mob'])
          if (key in json) json[key] = !json[key]
        return { ...e, parsedJson: json }
      }),
  }

  for (const [name, mutate] of Object.entries(MUTATIONS))
    test(`RED — a wrong encoding is caught: ${name}`, () => {
      const truth = fold_run(run.snapshot, run.batches).boundaries
      const wrong = fold_run(run.snapshot, run.batches, { encode_rows: mutate }).boundaries
      expect(wrong).not.toEqual(truth)
    })

  test('a HEAL folds hp — the spec table maps it to Granted, which moves a POOL and would drift', () => {
    const chain = build_chain()
    const [healer] = chain.sim_state.team0
    const hurt = { ...healer, health: healer.health - 30 }
    const pre = { ...chain.sim_state, team0: [hurt, ...chain.sim_state.team0.slice(1)] }
    const post = { ...pre, team0: [{ ...hurt, health: hurt.health + 8 }, ...pre.team0.slice(1)] }
    const { rows } = encode_sim_step({
      pre_state: pre,
      post_state: post,
      fight_id: FIGHT_ID,
      events: [
        {
          type: 'fight_cast',
          entity_id: healer.id,
          spell_id: 's_heal',
          target: hurt.cell,
          effects: [{ target_id: healer.id, heal: 8, new_health: hurt.health + 8 }],
        },
      ],
    })
    const view = view_of(snapshot_from_sim({ ...chain, sim_state: pre }, { now_ms: NOW }))
    const folded = fold_receipt(base_from_view(view, FIGHT_ID), { events: rows }, 2, view)
    expect(folded.fighters.p0.hp).toBe(hurt.health + 8)
    expect(fold_projection(folded)).toEqual(sim_projection(post))
  })
})

// ╔════════════════ [ Determinism ] ═══════════════════════════════════════════════════════════════════════ ]

describe('determinism — same seed + same command script', () => {
  test('two runs in ONE process produce byte-identical event streams AND folds', () => {
    const a = drive()
    const b = drive()
    expect(JSON.stringify(a.batches)).toBe(JSON.stringify(b.batches))
    expect(JSON.stringify(a.snapshot, bigint_safe)).toBe(JSON.stringify(b.snapshot, bigint_safe))
    expect(fold_run(a.snapshot, a.batches).boundaries).toEqual(fold_run(b.snapshot, b.batches).boundaries)
    expect(digest(a.chain.sim_state)).toBe(digest(b.chain.sim_state))
  })

  // The witness this whole file publishes on every run. A CHILD `bun test` of this same file re-derives it in a
  // fresh process (fresh module graph, fresh heap, fresh hash seeds); the parent compares the two strings.
  test('the run digest is published for the cross-process witness', () => {
    process.stdout.write(`\n${DIGEST_MARKER}${run_digest()}\n`)
    expect(run_digest()).toMatch(/^[0-9a-f]{8}$/)
  })

  // 120s: the child boots a whole `bun test` process and re-runs this file's own scripted fight.
  test.skipIf(!!process.env.SIM_CHAIN_CHILD)(
    'a run in a SEPARATE process produces the identical digest',
    () => {
      const here = fileURLToPath(new URL('./sim_chain.test.js', import.meta.url))
      const child = Bun.spawnSync(['bun', 'test', here], {
        env: { ...process.env, SIM_CHAIN_CHILD: '1' },
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      })
      const output = `${child.stdout.toString()}${child.stderr.toString()}`
      const seen = output.split('\n').find((line) => line.includes(DIGEST_MARKER))
      expect(seen).toBeDefined()
      expect(seen.slice(seen.indexOf(DIGEST_MARKER) + DIGEST_MARKER.length).trim()).toBe(run_digest())
    },
    120_000
  )

  test('a different seed produces a different fight', () => {
    expect(run_digest()).not.toBe(digest({ batches: drive({ seed: SEED + 1, fight_id: 'sim:other:1' }).batches }))
  })
})

const DIGEST_MARKER = 'SIM_CHAIN_RUN_DIGEST='
const bigint_safe = (_key, value) => (typeof value === 'bigint' ? `${value}n` : value)

/** The whole run's trace digest — the cross-process determinism witness. */
const run_digest = () => {
  const run = drive()
  return digest({ batches: run.batches, snapshot: JSON.parse(JSON.stringify(run.snapshot, bigint_safe)) })
}

// ╔════════════════ [ Physics + capsule ] ═════════════════════════════════════════════════════════════════ ]

describe('physics + capsule', () => {
  test('the scripted corpus trips ZERO physics tripwires', () => {
    expect(drive().chain.violations).toEqual([])
  })

  test('the dumped capsule replays clean and carries the seed (spec §8)', () => {
    const run = drive()
    const capsule = capsule_of(run.chain)
    expect(capsule).not.toBeNull()
    expect(capsule.meta.seed).toBe(SEED >>> 0)
    expect(capsule.meta.source).toBe('sentry')
    expect(capsule.commands.length).toBeGreaterThan(run.batches.length)
    // The header holds the RAW rows, never `ctx.spell_templates`: `replay_capsule` re-normalizes this field,
    // and `normalize_spell_templates` is NOT idempotent — fed its own output it degrades effects to
    // `UNSUPPORTED`, so a normalized header replays every spell inert and the fight never decides.
    expect(capsule.templates_raw).toEqual(TEMPLATES_RAW)
    const replayed = replay_capsule(JSON.parse(JSON.stringify(capsule)))
    expect(replayed.violations).toEqual([])
    // The capsule is a FIXTURE CANDIDATE: replaying its commands reproduces the run's own terminal fight.
    // Compared on the OBSERVABLE + the authored `terminal_summary`, not the raw state digest: `revive_arena`
    // re-derives `arena_radius` as `(width-1)/2`, which is a FLOAT on an even-width board, while every real
    // arena builder (arena.js `carve_world_arena`, sim_chain `arena_from_board`) uses `width >> 1`. That
    // cosmetic metadata mismatch is a timeline.js round-trip defect, reported upward, not this lane's to fix.
    expect(terminal_summary(replayed.terminal)).toEqual(terminal_summary(run.chain.sim_state))
    expect(sim_projection(replayed.terminal)).toEqual(sim_projection(run.chain.sim_state))
    // …and the WHOLE state matches too, that one re-derived field aside — effects, traps, hands, rng included.
    const comparable = (state) => digest({ ...state, arena_radius: 0 })
    expect(comparable(replayed.terminal)).toBe(comparable(run.chain.sim_state))
  })

  test('STOP mid-fight forfeits every living seat and drives the terminal rows', () => {
    const chain = build_chain()
    const { receipt, version } = abandon_fight(chain, { now_ms: NOW })
    const kinds = receipt.events.map((e) => e.type.split('::').pop())
    expect(kinds).toContain('Defeat')
    expect(version).toBe(chain.version + 1)
  })
})

// ╔════════════════ [ Loudness — an unmapped fact is never silently dropped ] ═════════════════════════════ ]

describe('loudness — the mock never drops a fact', () => {
  const chain = build_chain()
  const step = (extra) => ({
    pre_state: chain.sim_state,
    post_state: chain.sim_state,
    fight_id: FIGHT_ID,
    events: [],
    ...extra,
  })

  test('an unmapped sim event throws', () => {
    expect(() => encode_sim_step(step({ events: [{ type: 'fight_joined', entity_id: 'sim_c1' }] }))).toThrow(
      /unmapped sim event/
    )
  })

  test('an unmapped effect status throws', () => {
    expect(() =>
      encode_sim_step(
        step({
          events: [
            {
              type: 'fight_cast',
              entity_id: 'sim_c1',
              target: chain.sim_state.team0[0].cell,
              effects: [{ target_id: 'sim_c1', status: 'A_BRAND_NEW_MECHANIC' }],
            },
          ],
        })
      )
    ).toThrow(/unmapped effect status/)
  })

  test('a summon (a roster that grew mid-step) throws — no chain row can express it', () => {
    const grown = { ...chain.sim_state, team1: [...chain.sim_state.team1, chain.sim_state.team1[0]] }
    expect(() => encode_sim_step(step({ post_state: grown }))).toThrow(/roster changed mid-step/)
  })

  test('a staged WEAPON strike throws — the sim reducer has no weapon command', () => {
    expect(() => commands_from_staged([{ kind: 2, target: 40 }], 'sim_c1')).toThrow(/no sim command/)
  })

  test('a staged draft becomes move-path + cast + a closing end_turn', () => {
    expect(
      commands_from_staged(
        [
          { kind: 0, target: 21 },
          { kind: 0, target: 22 },
          { kind: 1, target: 41, spell_template_id: 's_nuke' },
        ],
        'sim_c1'
      )
    ).toEqual([
      {
        type: 'move',
        entity_id: 'sim_c1',
        path: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
      },
      { type: 'cast', entity_id: 'sim_c1', spell_id: 's_nuke', target: { x: 1, y: 2 } },
      { type: 'end_turn', entity_id: 'sim_c1' },
    ])
    // a zero-draft turn still commits — that is what hands the mobs their wave (turn_commit.js)
    expect(commands_from_staged([], 'sim_c1')).toEqual([{ type: 'end_turn', entity_id: 'sim_c1' }])
  })
})
