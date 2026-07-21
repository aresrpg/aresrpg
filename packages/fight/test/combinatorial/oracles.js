// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE COMBINATORIAL ORACLES — pure verdicts over one folded fight's presentation output.
//
// Every function here is a PURE transform: it takes the paced `wave` (the store's beat stream) and/or the
// terminal projections, and returns a flat list of violation rows (never throws, never logs). The driver
// (driver.js) runs a real sim combination, folds it through the store, then hands the beats + terminal views
// here. Findings are cataloged; the ratchet test (combinatorial.test.js) decides pass/fail against a worklist.
//
// Reused, never rebuilt: the SPEC-table oracles (evaluate_trajectory · evaluate_trace) are imported verbatim
// from test/gold/specs_anchor — the SAME machine twins the browser conformance suites use. The trajectory
// trace is PROJECTED from the beat paths (the fold-level analog of the engine pos-trace): world XZ = cell ×
// DEFAULT_CELL_SIZE, exactly the trajectory evaluator's own geometry.

import { evaluate_trajectory, DEFAULT_CELL_SIZE } from '../../../../test/gold/specs_anchor/trajectory_eval.ts'
import { evaluate_trace } from '../../../../test/gold/specs_anchor/pacing_envelopes.ts'

// ── Clock: the serial render-queue clock (envelopes_7b.trace_of idiom). Each turn opens at the previous
//    turn's completion (+1ms next-turn tick); every beat fires at head + beat.at. Turn-local `at` is the
//    stream's contract, so this is the ONLY faithful absolute clock for the beats. ────────────────────────
const T0 = 1_000_000

/** Flatten the wave into absolute-timed beats: [{ t, kind, at, duration, payload, is_local, turn }]. */
const absolute_beats = (wave) => {
  const rows = []
  let head = T0
  let turn = 0
  for (const t of wave) {
    for (const b of t.beats ?? [])
      rows.push({
        t: head + (b.at ?? 0),
        kind: b.kind,
        at: b.at ?? 0,
        duration: b.duration ?? 0,
        payload: b.payload ?? {},
        is_local: !!t.is_local,
        turn,
      })
    head += (t.duration ?? 0) + 1
    turn += 1
  }
  return rows
}

const world_of = (cell, cell_size) => ({ x: (cell?.x ?? 0) * cell_size, z: (cell?.y ?? 0) * cell_size })

/** Split a cardinal path into maximal STRAIGHT runs (constant direction) — the trajectory evaluator's
 *  monotonic/arrival checks are straight-line, so a bent path must be declared as separate straight sub-moves
 *  (its own doc: "no path bend, or pass waypoints as separate straight sub-moves"). */
const straight_runs = (path) => {
  if (!Array.isArray(path) || path.length <= 1) return path?.length ? [path] : []
  const runs = []
  let start = 0
  const dir = (i) => ({ dx: Math.sign(path[i].x - path[i - 1].x), dy: Math.sign(path[i].y - path[i - 1].y) })
  let cur = dir(1)
  for (let i = 2; i < path.length; i++) {
    const d = dir(i)
    if (d.dx !== cur.dx || d.dy !== cur.dy) {
      runs.push(path.slice(start, i))
      start = i - 1
      cur = d
    }
  }
  runs.push(path.slice(start))
  return runs
}

// ── ORACLE 1 · BEAT GRAMMAR — the fold's ordering + displacement + trap + death invariants over the stream ──
export const beat_grammar_violations = (wave, { trap_cells = [], grid_width = 20 } = {}) => {
  const out = []
  const trap_set = new Set(trap_cells.map((c) => (typeof c === 'number' ? c : c.y * grid_width + c.x)))
  const cell_key = (c) => (c == null ? null : `${c.x},${c.y}`)
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

  wave.forEach((turn, ti) => {
    const beats = turn.beats ?? []
    // (a) CAST BEFORE ITS EFFECTS: a damage/displacement/death that precedes EVERY action opener (cast/move/
    //     trap_place) in the same turn is an effect rendered ahead of its cause (the mis-ordered flush class).
    const first_opener = beats.findIndex((b) => b.kind === 'cast' || b.kind === 'move' || b.kind === 'trap_place')
    beats.forEach((b, bi) => {
      if ((b.kind === 'damage' || b.kind === 'displacement') && first_opener !== -1 && bi < first_opener)
        out.push(
          `grammar.cast_before_effects: turn ${ti} beat ${bi} '${b.kind}' precedes first opener at ${first_opener}`
        )
    })

    // (b) DISPLACEMENT STOPS AT to_cell (never `requested` beyond); path ends AT to; slide dist ≤ requested.
    for (const b of beats)
      if (b.kind === 'displacement') {
        const { from, to, path = [], requested = 0, effect_kind } = b.payload
        const is_teleport = Number(effect_kind) === 14
        if (!is_teleport && path.length > 0 && cell_key(path[path.length - 1]) !== cell_key(to))
          out.push(
            `grammar.displacement_stop: turn ${ti} slide path ends ${cell_key(path[path.length - 1])} != to ${cell_key(to)}`
          )
        if (from && to && requested > 0 && dist(from, to) > requested)
          out.push(`grammar.displacement_overshoot: turn ${ti} moved ${dist(from, to)} > requested ${requested}`)
      }

    // (c) TRAP_TRIGGER AT the trap cell — the fired trap's cell is a placed trap cell, and matches the victim's
    //     landing (the immediately-preceding arrival/displacement destination for that entity).
    beats.forEach((b, bi) => {
      if (b.kind !== 'trap_trigger') return
      const { cell } = b.payload
      const enc = cell == null ? null : cell.y * grid_width + cell.x
      if (trap_set.size > 0 && enc != null && !trap_set.has(enc))
        out.push(`grammar.trap_cell: turn ${ti} trap fired at ${cell_key(cell)} — not a placed trap cell`)
      const id = b.payload.target_id ?? b.payload.entity_id
      const landing = beats
        .slice(0, bi)
        .reverse()
        .find(
          (p) =>
            (p.kind === 'arrival' && p.payload.entity_id === id && p.payload.cell) ||
            (p.kind === 'displacement' && p.payload.target_id === id && p.payload.to)
        )
      const at = landing ? (landing.kind === 'arrival' ? landing.payload.cell : landing.payload.to) : null
      if (at && cell_key(at) !== cell_key(cell))
        out.push(`grammar.trap_landing: turn ${ti} trap at ${cell_key(cell)} != victim landing ${cell_key(at)}`)
    })

    // (d) LETHAL DAMAGE IS FLAGGED — #170 (5th recurrence): there is no separate 'death' beat anymore (the
    //     presenter derives the death visual from the presented-state alive→dead edge, never the wave grammar);
    //     the invariant narrows to "a lethal hit's damage beat is flagged `killed`" so new_health/killed can
    //     never desync — the presenter's whole edge-detection trusts `killed` as the honest cause signal.
    for (const b of beats)
      if (b.kind === 'damage' && b.payload.new_health === 0 && !b.payload.killed)
        out.push(
          `grammar.death_beat: turn ${ti} lethal hit on ${b.payload.target_id} (new_health 0) missing killed flag`
        )

    // (e) MOVE path integrity — the arrival beat's cell equals the walked path's end, and the path is a
    //     contiguous 4-dir cardinal sequence (a gap/diagonal is a malformed render path).
    beats.forEach((b, bi) => {
      if (b.kind !== 'move') return
      const path = b.payload.path ?? []
      for (let i = 1; i < path.length; i++)
        if (dist(path[i], path[i - 1]) !== 1)
          out.push(
            `grammar.move_path: turn ${ti} step ${i} ${cell_key(path[i - 1])}->${cell_key(path[i])} not a 4-dir move`
          )
      const arrival = beats
        .slice(bi + 1)
        .find((p) => p.kind === 'arrival' && p.payload.entity_id === b.payload.entity_id)
      if (arrival && path.length && cell_key(arrival.payload.cell) !== cell_key(path[path.length - 1]))
        out.push(
          `grammar.move_arrival: turn ${ti} arrival ${cell_key(arrival.payload.cell)} != path end ${cell_key(path[path.length - 1])}`
        )
    })
  })
  return out
}

// ── ORACLE 2 · TRAJECTORY — project each movement beat's cell path into a pos-trace + declared moves, run the
//    twin. Each movement-beat OCCURRENCE gets a UNIQUE mover id so windows never cross-contaminate; a bent
//    path is declared as one straight-run walk per constant-direction segment (the evaluator's monotonic +
//    arrival checks are straight-line — see its own doc). Teleports declare the lawful single jump. ─────────
export const trajectory_violations = (wave, { cell_size = DEFAULT_CELL_SIZE } = {}) => {
  const rows = absolute_beats(wave)
  const trace = []
  const moves = []
  let seq = 0
  const frac = (i, n) => (n <= 1 ? 1 : i / (n - 1))

  for (const b of rows) {
    const t0 = b.t
    const span = Math.max(1, b.duration || 1)
    if (b.kind === 'move') {
      const path = b.payload.path ?? []
      if (!path.length) continue
      const id = `${b.payload.entity_id}#m${seq++}`
      path.forEach((cell, i) => trace.push({ t: t0 + frac(i, path.length) * span, id, ...world_of(cell, cell_size) }))
      let acc = 0
      for (const run of straight_runs(path)) {
        const s0 = acc
        acc += run.length - 1
        moves.push({
          id,
          kind: 'walk',
          to: world_of(run[run.length - 1], cell_size),
          t_start: t0 + frac(s0, path.length) * span,
          t_end: t0 + frac(acc, path.length) * span,
        })
      }
    } else if (b.kind === 'displacement') {
      const path = b.payload.path ?? []
      const { to } = b.payload
      const teleport = Number(b.payload.effect_kind) === 14 || path.length === 0
      const id = `${b.payload.target_id}#d${seq++}`
      if (teleport) {
        const from = b.payload.from ?? to
        trace.push({ t: t0, id, ...world_of(from, cell_size) })
        trace.push({ t: t0 + span, id, ...world_of(to, cell_size) })
        moves.push({ id, kind: 'teleport', to: world_of(to, cell_size), t_start: t0, t_end: t0 + span })
      } else {
        path.forEach((cell, i) => trace.push({ t: t0 + frac(i, path.length) * span, id, ...world_of(cell, cell_size) }))
        let acc = 0
        for (const run of straight_runs(path)) {
          const s0 = acc
          acc += run.length - 1
          moves.push({
            id,
            kind: 'walk',
            to: world_of(run[run.length - 1], cell_size),
            t_start: t0 + frac(s0, path.length) * span,
            t_end: t0 + frac(acc, path.length) * span,
          })
        }
      }
    }
  }

  const v = evaluate_trajectory(trace, moves, { cell_size })
  const out = []
  for (const d of v.discontinuity_violations)
    out.push(`trajectory.${d.signature}: ${d.id} @${Math.round(d.at_ms)} ${d.jump_cells.toFixed(2)}c`)
  for (const m of v.monotonic_violations)
    out.push(`trajectory.monotonic: ${m.id} @${Math.round(m.at_ms)} +${m.regress_cells.toFixed(2)}c`)
  for (const tp of v.teleport_violations) out.push(`trajectory.teleport_count: ${tp.id} found ${tp.found}`)
  for (const a of v.arrival_violations) out.push(`trajectory.arrival: ${a.id} off ${a.off_cells.toFixed(2)}c`)
  return out
}

// ── ORACLE 3 · §7b PACING — the paced beats → the browser probe's BeatTraceRow shape → the same evaluator.
//    Split into HARD ordering invariants (a floater/death rendered before its cause — a real sequencing bug)
//    and SOFT envelope timings (E-row ms windows: the §7b numbers are explicitly PROPOSED/owner-tunable, and
//    the true death/turn HOLD is ack-enforced by the store, not by a beat's rendered duration — so a dense
//    turn's rescale-compressed slot is a cataloged FINDING, never a hard gate). ──────────────────────────────
const pacing_verdict = (wave) => {
  const rows = []
  let head = T0
  for (const t of wave) {
    if (t.is_local) continue // §7b measures the non-local (receipt-paced) presentation slots
    for (const b of t.beats ?? [])
      rows.push({
        t: head + (b.at ?? 0),
        lane: 'beat',
        kind: b.kind,
        id: b.payload?.entity_id ?? b.payload?.target_id ?? null,
      })
    head += (t.duration ?? 0) + 1
  }
  return evaluate_trace(rows)
}

/** HARD — a beat rendered before its cause (death before its floater, floater before its vfx). Gates pass/fail. */
export const pacing_order_violations = (wave) =>
  pacing_verdict(wave).order_violations.map((o) => `order.${o.rule}: @${Math.round(o.at_ms)} (${o.actor ?? '-'})`)

/** SOFT — the E-row envelope timings + dead-air + teleport. Cataloged findings, never a hard gate. */
export const pacing_envelope_findings = (wave) => {
  const v = pacing_verdict(wave)
  const out = []
  for (const e of v.envelope_violations)
    out.push(`${e.key}.${e.verdict}: ${Math.round(e.interval_ms)}ms (${e.actor ?? '-'})`)
  for (const g of v.dead_air_violations) out.push(`dead_air.E12: ${Math.round(g.interval_ms)}ms`)
  for (const tp of v.teleport_violations) out.push(`teleport: ${tp.id} @${Math.round(tp.at_ms)}`)
  return out
}

// ── ORACLE 4 · STATE PARITY — the fold's terminal projection equals the sim's terminal truth (HP/cell/alive/
//    invisible). `entries` = [{ label, sim, folded }] built by the driver's id-map (fold key ↔ sim entity). ──
export const parity_violations = (entries) => {
  const out = []
  for (const { label, sim, folded } of entries) {
    if (sim == null || folded == null) {
      out.push(`parity.missing: ${label} (sim=${sim == null ? 'x' : 'ok'} folded=${folded == null ? 'x' : 'ok'})`)
      continue
    }
    if (Number(sim.health) !== Number(folded.health))
      out.push(`parity.hp: ${label} sim ${sim.health} != folded ${folded.health}`)
    const sc = sim.cell
    const fc = folded.cell
    if (sc && fc && (sc.x !== fc.x || sc.y !== fc.y))
      out.push(`parity.cell: ${label} sim ${sc.x},${sc.y} != folded ${fc.x},${fc.y}`)
    if (!!sim.alive !== !!folded.alive) out.push(`parity.alive: ${label} sim ${sim.alive} != folded ${folded.alive}`)
    if (sim.invisible != null && folded.invisible != null && !!sim.invisible !== !!folded.invisible)
      out.push(`parity.invisible: ${label} sim ${sim.invisible} != folded ${folded.invisible}`)
  }
  return out
}

/** Aggregate every oracle for one folded combination. `hard` families gate pass/fail (correctness); `soft`
 *  families (the tunable §7b envelope timings) are cataloged findings that never gate. */
export const run_oracles = ({ wave, trap_cells, grid_width, parity_entries }) => ({
  hard: {
    grammar: beat_grammar_violations(wave, { trap_cells, grid_width }),
    trajectory: trajectory_violations(wave, { grid_width }),
    parity: parity_violations(parity_entries ?? []),
    pacing_order: pacing_order_violations(wave),
  },
  soft: {
    pacing: pacing_envelope_findings(wave),
  },
})
