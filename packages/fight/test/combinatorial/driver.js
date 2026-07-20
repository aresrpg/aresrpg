// THE COMBINATORIAL DRIVER — run one chain-free sim combination end-to-end through the REAL pipeline and judge
// it. Flow (the brief's step 2/3): drive the sim (auto-AI mob turns + the combo's scripted player turns) →
// bridge the ordered sim events into chain receipts + the initial snapshot → fold through the store (the SAME
// door the renderer consumes) → read the paced wave (beats) + the committed terminal fold → run every oracle.
//
// Determinism: the whole run is seeded by arena_seed; a failure replays byte-identically from { name, seed }.

import { reduce, get_current_turn_entity, find_entity, is_invisible } from '@aresrpg/sim'
import { create_fight_store, committed_state } from '@aresrpg/fight'

import { build_templates, build_state } from './entities.js'
import { sim_to_chain, snapshot_of, entity_index } from './bridge.js'
import { run_oracles } from './oracles.js'

const GRID_W = 20
const MAX_STEPS = 80 // hard cap so a pathological policy can't loop (the sim also has its own stalemate backstop)
const decode = (enc) => (enc == null ? null : { x: Number(enc) % GRID_W, y: Math.floor(Number(enc) / GRID_W) })

/** Drive the sim: mob turns auto-play AI; player turns run combo.player_turn(state, {find}, pturn) → commands.
 *  Returns the ordered event stream, the union of every placed trap cell, and the terminal sim state. */
const capture = (initial, ctx, combo) => {
  let state = initial
  const events = []
  const trap_cells = new Map() // enc → {x,y}
  const collect = (r) => {
    for (const e of r.events) events.push(e)
    for (const t of r.state.traps ?? []) for (const c of t.cells) trap_cells.set(c.y * GRID_W + c.x, c)
    return r.state
  }
  let pturn = 0
  let rejected_casts = 0 // policy casts the sim refused (bad range/LoS/target) — a combo-authoring bug, never silent
  for (let step = 0; step < MAX_STEPS; step++) {
    const cur = get_current_turn_entity(state)
    if (!cur || state.winner !== -1) break
    if (!cur.is_player) {
      state = collect(reduce(state, { type: 'ai_turn', entity_id: cur.id }, ctx))
      continue
    }
    const cmds = combo.player_turn(state, { find: (id) => find_entity(state, id) }, pturn) ?? []
    for (const c of cmds) {
      if (state.winner !== -1) break
      const r = reduce(state, c, ctx)
      if (c.type === 'cast' && !r.events.some((e) => e.type === 'fight_cast')) rejected_casts += 1
      state = collect(r)
    }
    if (state.winner === -1 && get_current_turn_entity(state)?.id === cur.id)
      state = collect(reduce(state, { type: 'end_turn', entity_id: cur.id }, ctx))
    pturn++
    if (combo.max_player_turns && pturn >= combo.max_player_turns) break
  }
  return { events, trap_cells: [...trap_cells.values()], final: state, rejected_casts }
}

/** The committed terminal fold projected to { key → {health, cell{x,y}, alive, invisible} }. */
const fold_terminal = (store) => {
  const c = committed_state(store.getState())
  const out = {}
  for (const [key, f] of Object.entries(c.fighters ?? {}))
    out[key] = { health: f.hp, cell: decode(f.cell), alive: f.alive, invisible: !!f.invisible }
  return out
}

/** Sim terminal → { key → {health, cell, alive, invisible} } keyed the same as the fold (p{seat}/m{idx}). */
const sim_terminal = (final) => {
  const out = {}
  final.team0.forEach(
    (e, i) => (out[`p${i}`] = { health: e.health, cell: e.cell, alive: e.health > 0, invisible: is_invisible(e) })
  )
  final.team1.forEach(
    (e, i) => (out[`m${i}`] = { health: e.health, cell: e.cell, alive: e.health > 0, invisible: is_invisible(e) })
  )
  return out
}

/**
 * Run one combination. `combo` = { name, seed, setup(): { arena, obstacles, team0, team1 },
 *   player_turn(state, api, pturn): commands[], max_player_turns? }. Returns the verdict + oracle findings.
 */
export const drive_combo = (combo) => {
  const { arena, obstacles = [], team0, team1 } = combo.setup()
  const initial = build_state({ fight_id: combo.fight_id ?? 'combo', seed: combo.seed, arena, team0, team1 })
  const ctx = { spell_templates: combo.templates ?? build_templates(), arena }
  const ref = entity_index(initial)

  const { events, trap_cells, final, rejected_casts } = capture(initial, ctx, combo)
  const chain = sim_to_chain(initial, events, ref, trap_cells)
  const snapshot = snapshot_of(initial, { obstacles })

  const store = create_fight_store()
  const T0 = 1_000
  store
    .getState()
    .input(
      {
        type: 'init',
        fight_id: initial.fight_id,
        ctx: { my_entity_id: '0xspectator', address: '0xspectator', beat_ctx: { grid_width: GRID_W } },
      },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: snapshot, version: 1 }, T0 + 10)
  store
    .getState()
    .input({ type: 'receipt', receipt: { events: chain.events }, version: 2, trap_cells: chain.trap_cells }, T0 + 100)

  const wave = store.getState().wave ?? []
  const folded = fold_terminal(store)
  const sim = sim_terminal(final)
  const parity_entries = [...new Set([...Object.keys(sim), ...Object.keys(folded)])].map((key) => ({
    label: key,
    sim: sim[key] ?? null,
    folded: folded[key] ?? null,
  }))

  const oracles = run_oracles({ wave, trap_cells: chain.trap_cells, grid_width: GRID_W, parity_entries })
  const hard = Object.entries(oracles.hard).flatMap(([family, rows]) => rows.map((r) => `${family}: ${r}`))
  const soft = Object.entries(oracles.soft).flatMap(([family, rows]) => rows.map((r) => `${family}: ${r}`))
  // a policy cast the sim refused = an invalid combo that never tested its mechanic — a HARD integrity failure.
  if (rejected_casts > 0)
    hard.push(`harness: ${rejected_casts} policy cast(s) rejected by the sim (bad range/LoS/target)`)

  return {
    name: combo.name,
    seed: combo.seed,
    pass: hard.length === 0,
    hard,
    soft,
    counts: {
      sim_events: events.length,
      chain_events: chain.events.length,
      wave_turns: wave.length,
      beats: wave.reduce((n, t) => n + (t.beats?.length ?? 0), 0),
      trap_cells: chain.trap_cells.length,
    },
  }
}
