// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE trajectory-conformance evaluator over the engine position-trace tap (packages/engine/src/tactical/
// pos_trace.js — window.__ARES_POS_TRACE, {t,id,cell,x,y,z} at ~15Hz): every glb position must be logged
// and verified as being in the right place during movements. The outcome-only suite let SNAP-THEN-RUN
// pass (the rig teleported onto the destination, rolled back, then ran the path — d4f9e748 / 620f8f6f fixed
// it); these assertions LOCK that fix by asserting the WHOLE trajectory, not just its endpoints.
//
// Pure module: plain data + pure transforms, zero I/O, zero playwright/bun imports — consumed by
// trajectory_conformance.spec.ts (the driven browser trace) and trajectory_eval_test.ts (synthetic traces).
// The SPEC-table twin of pacing_envelopes.ts; every threshold is a named, overridable option.
//
// Geometry: the tactical board lies on the X-Z plane (Y is up — walk-anim bob is ignored); one board cell is
// DEFAULT_CELL_SIZE = 1.33 world units (packages/engine/src/tactical/board.js, D231). Distances are measured
// in the horizontal plane (hypot(dx,dz)) — the same {x,z} the engine's own render_position_of reports.
//
// The four per-mover conformance checks (the "right place during movements" lock):
//   ① NO discontinuity: consecutive samples never jump > `jump_cells` cells — EXCEPT the ONE jump a declared
//      teleport beat is allowed. The snap-then-run signature (a destination-adjacent sample BEFORE the path
//      interpolation, i.e. the rig sitting on the target then leaving it to re-walk) is named `snap_then_run`.
//   ② MONOTONIC progress: within a walk, straight-line distance-to-destination is non-increasing (± tolerance).
//      NOTE: straight-line — a driven walk asserted with an explicit move beat must be an UNOBSTRUCTED move
//      (open ground, no path bend), or pass its waypoints as separate straight sub-moves.
//   ③ TELEPORT = exactly ONE discontinuity inside its window (zero = never jumped, two+ = glitched/snap).
//   ④ ARRIVAL: the last sample of a move ≈ the destination cell centre (± tolerance).

export type Vec2 = { readonly x: number; readonly z: number }

/** One position-trace sample (the engine tap's row shape; `cell`/`y` accepted but unused by the checks). */
export type PosSample = {
  readonly t: number
  readonly id: string
  readonly x: number
  readonly y?: number
  readonly z: number
  readonly cell?: { readonly x: number; readonly y: number } | null
}

/** A declared movement beat — what the driver commanded, so the trace can be judged against intent.
 *  `to` is the destination cell CENTRE in world (x,z). `from` is documentation only (unused by the checks). */
export type MoveBeat = {
  readonly id: string
  readonly kind: 'walk' | 'teleport'
  readonly to: Vec2
  readonly t_start: number
  readonly t_end: number
  readonly from?: Vec2
}

export type TrajectoryOpts = {
  /** world units per board cell (default DEFAULT_CELL_SIZE = 1.33). */
  readonly cell_size?: number
  /** discontinuity threshold, in cells (default 1.5). */
  readonly jump_cells?: number
  /** "≈ destination centre" tolerance, in cells (default 0.5). */
  readonly arrival_tol_cells?: number
  /** monotonic backtrack tolerance, in cells (default 0.25 — absorbs walk-anim bob/overshoot). */
  readonly mono_tol_cells?: number
  /** consecutive pairs farther apart in time than this are a SAMPLING GAP — motion across them is
   *  unknowable, so they are not judged for discontinuity (default 250ms ≈ 4 dropped 15Hz frames; below the
   *  ~297ms a legit run needs to cover 1.5 cells, so no legit run across a gap can false-positive). */
  readonly max_dt_ms?: number
}

/** DEFAULT_CELL_SIZE mirror (packages/engine/src/tactical/board.js:56, D231 "−33% cells") — the driven row's cell size. */
export const DEFAULT_CELL_SIZE = 1.33

const DEFAULTS = Object.freeze({
  cell_size: DEFAULT_CELL_SIZE,
  jump_cells: 1.5,
  arrival_tol_cells: 0.5,
  mono_tol_cells: 0.25,
  max_dt_ms: 250,
})

export type Discontinuity = {
  readonly id: string
  readonly at_ms: number
  readonly jump_cells: number
  /** which declared move window this jump fell inside (null = between/outside declared moves). */
  readonly during: 'walk' | 'teleport' | null
  readonly signature: 'jump' | 'snap_then_run'
}
export type Regression = { readonly id: string; readonly at_ms: number; readonly regress_cells: number }
export type TeleportCount = { readonly id: string; readonly t_start: number; readonly found: number }
export type ArrivalOff = { readonly id: string; readonly t_end: number; readonly off_cells: number }

export type TrajectoryVerdict = {
  readonly movers: readonly string[]
  /** ① walk / outside-window jumps (a declared teleport's ONE jump is excused). */
  readonly discontinuity_violations: readonly Discontinuity[]
  /** ② a walk's distance-to-destination increased beyond tolerance. */
  readonly monotonic_violations: readonly Regression[]
  /** ③ a teleport did not produce exactly one discontinuity. */
  readonly teleport_violations: readonly TeleportCount[]
  /** ④ a move's final sample was off its destination centre. */
  readonly arrival_violations: readonly ArrivalOff[]
}

/** Horizontal (board-plane) distance between two world points — Y (walk bob) deliberately ignored. */
const horiz = (a: { readonly x: number; readonly z: number }, b: { readonly x: number; readonly z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

const samples_of = (trace: readonly PosSample[], id: string) =>
  trace.filter((row) => row.id === id).sort((a, b) => a.t - b.t)

/** A jump (a>jump_world consecutive-pair displacement) is attributed to a move only when it lies FULLY inside
 *  that move's window — a straddling jump stays unattributed (during=null). */
const kind_containing = (moves: readonly MoveBeat[], id: string, a_t: number, b_t: number) =>
  moves.find((m) => m.id === id && a_t >= m.t_start && b_t <= m.t_end)?.kind ?? null

const window_samples = (trace: readonly PosSample[], m: MoveBeat) =>
  samples_of(trace, m.id).filter((row) => row.t >= m.t_start && row.t <= m.t_end)

/**
 * The trajectory conformance evaluator — pure verdicts over a position trace + the moves that produced it.
 * Pass `moves: []` to run the geometry-only discontinuity scan (the driven row's default: ANY jump in a
 * no-teleport fight is a snap). Declare moves to additionally assert monotonic progress (②, walk), the
 * one-jump teleport law (③), and arrival on centre (④), and to EXCUSE a teleport's single lawful jump (①).
 */
export const evaluate_trajectory = (
  trace: readonly PosSample[],
  moves: readonly MoveBeat[] = [],
  opts: TrajectoryOpts = {}
): TrajectoryVerdict => {
  const cs = opts.cell_size ?? DEFAULTS.cell_size
  const jump_world = (opts.jump_cells ?? DEFAULTS.jump_cells) * cs
  const arrival_world = (opts.arrival_tol_cells ?? DEFAULTS.arrival_tol_cells) * cs
  const mono_world = (opts.mono_tol_cells ?? DEFAULTS.mono_tol_cells) * cs
  const max_dt = opts.max_dt_ms ?? DEFAULTS.max_dt_ms
  const to_cells = (world: number) => world / cs
  const movers = [...new Set(trace.map((row) => row.id))].sort()
  const walks = moves.filter((m) => m.kind === 'walk')

  /** Consecutive same-mover pairs whose horizontal displacement exceeds the jump threshold. Sampling gaps
   *  beyond max_dt are skipped — motion across them is unknowable. Pure: a flatMap over the shifted pairs. */
  const jumps_in = (ss: readonly PosSample[]) =>
    ss.slice(1).flatMap((b, i) => {
      const a = ss[i]!
      const jump = horiz(a, b)
      return b.t - a.t <= max_dt && jump > jump_world ? [{ a, b, jump }] : []
    })

  // ① discontinuity — every mover's raw jumps, EXCEPT the one jump a declared teleport window is allowed
  // (③ owns that count). A walk jump or an unexplained (outside-window) jump is a red.
  const raw_jumps = movers.flatMap((id) =>
    jumps_in(samples_of(trace, id)).flatMap(({ a, b, jump }) => {
      const during = kind_containing(moves, id, a.t, b.t)
      return during === 'teleport'
        ? []
        : [{ id, at_ms: b.t, jump_cells: to_cells(jump), during, signature: 'jump' as const }]
    })
  )

  // ① (named) snap-then-run — a WALK window holding a destination-adjacent sample FOLLOWED by a sample far
  // from the destination: the rig reached the target, then left it to re-walk (the fixed bug's signature).
  const snap_then_run = walks.flatMap((m) => {
    const ws = window_samples(trace, m)
    const i = ws.findIndex((s) => horiz(s, m.to) <= arrival_world) // the FIRST destination-adjacent sample
    if (i < 0) return []
    const rollback = Math.max(0, ...ws.slice(i + 1).map((s) => horiz(s, m.to)))
    return rollback > jump_world
      ? [
          {
            id: m.id,
            at_ms: ws[i]!.t,
            jump_cells: to_cells(rollback),
            during: 'walk' as const,
            signature: 'snap_then_run' as const,
          },
        ]
      : []
  })

  // ② monotonic progress — a walk's straight-line distance-to-destination is non-increasing (± mono tol).
  const monotonic_violations = walks.flatMap(
    (m) =>
      window_samples(trace, m).reduce<{ readonly min: number; readonly out: readonly Regression[] }>(
        (acc, s) => {
          const d = horiz(s, m.to)
          const out =
            d > acc.min + mono_world
              ? [...acc.out, { id: m.id, at_ms: s.t, regress_cells: to_cells(d - acc.min) }]
              : acc.out
          return { min: Math.min(acc.min, d), out }
        },
        { min: Number.POSITIVE_INFINITY, out: [] }
      ).out
  )

  // ③ teleport law — exactly ONE discontinuity inside the window (0 = never jumped, ≥2 = glitch/snap).
  const teleport_violations = moves
    .filter((m) => m.kind === 'teleport')
    .flatMap((m) => {
      const found = jumps_in(window_samples(trace, m)).length
      return found === 1 ? [] : [{ id: m.id, t_start: m.t_start, found }]
    })

  // ④ arrival — the last sample of each move ≈ its destination centre (empty windows assert nothing).
  const arrival_violations = moves.flatMap((m) => {
    const ws = window_samples(trace, m)
    if (ws.length === 0) return []
    const off = horiz(ws[ws.length - 1]!, m.to)
    return off > arrival_world ? [{ id: m.id, t_end: m.t_end, off_cells: to_cells(off) }] : []
  })

  return {
    movers,
    discontinuity_violations: [...raw_jumps, ...snap_then_run],
    monotonic_violations,
    teleport_violations,
    arrival_violations,
  }
}
