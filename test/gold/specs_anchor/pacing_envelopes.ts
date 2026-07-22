// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE EXECUTABLE TWIN of SPEC.md §7b (fight presentation pacing) — the ONE machine-readable home of the
// envelope numbers. The SPEC's human table MIRRORS these rows; the conformance suite and units read THIS
// module. Retune here (retune at will — every number is PROPOSED), mirror the SPEC table.
//
// Sources (per-bound attribution in each row's `source`):
//   D = retro-1.29 canon — decompiled client bytes (20 fps root clock = 50 ms frame quantum) + reference
//       server constants (D_PACING_RESEARCH digest).
//   W = the W reference 0.23.6 — UnityPy extraction of serialized Timeline/Camera/Cell track fields
//       (W_PACING_RESEARCH digest).
//   O = a direct ruling (test/gold/COMPLAINT_LEDGER.md).
//   derived = arithmetic over a cited source value — flagged, weakest tier, first to veto.
//
// Pure module: plain data + pure transforms, zero I/O, zero playwright/bun imports — consumed by
// pacing_conformance.spec.ts (browser trace) and pacing_envelopes_test.ts (fixture traces).

/** One probe-derived presentation event. `lane` 'beat' = render-queue beat start (__ARES_FIGHT_PROBE.beats),
 *  'vfx' = delivery VFX mount (probe.vfx, id = caster), 'upsert' = rig snap placement (probe.upserts). */
export type BeatTraceRow = {
  readonly t: number
  readonly lane: 'beat' | 'vfx' | 'upsert'
  readonly kind: string
  readonly id: string | null
}

export type EnvelopeRow = {
  readonly key: string
  readonly pair: string
  /** null = RULING-PENDING (no source covers the bound). */
  readonly min_ms: number | null
  readonly max_ms: number | null
  readonly source: string
  /** v1 conformance measures this row from the live trace; false rows are documented targets only. */
  readonly measured: boolean
}

/** D: the 1.29 client runs a 20 fps root clock — 50 ms is one frame, the honest measurement tolerance. */
export const JITTER_MS = 50

export const PACING_ENVELOPES: readonly EnvelopeRow[] = [
  {
    key: 'E1',
    pair: 'cast (swing start) → spell VFX mount',
    min_ms: 0,
    max_ms: 1400,
    source: 'min W (first VFX clip m_Start=0 on 98% of 1978 fx) · max D (cast lead-in anims block 0.75–1.4s)',
    measured: true,
  },
  {
    key: 'E2',
    pair: 'VFX delivery → damage floater pop',
    min_ms: 0,
    max_ms: 600,
    source:
      'min W (cast→impact mode 0, med 0.233s) · max D (number lifetime ~600ms, queue-advance ~450ms; W flow-hold med 0.55s agrees) · O red-line: "at least 1s late" is the gated complaint',
    measured: true,
  },
  {
    key: 'E3',
    pair: 'floater → next floater (serial victims of one cast)',
    min_ms: 100,
    max_ms: 1000,
    source:
      'min derived (O serial law "never in parallel" × D 2-frame quantum) · max W (impact-punch mode 1.0s; D queue-advance 450ms inside)',
    measured: true,
  },
  {
    key: 'E4',
    pair: 'lethal floater → death animation start',
    min_ms: 0,
    max_ms: 600,
    source: 'min D (death blocks at the killing impact) · max derived D (0.60s universal hit recoil precedes it)',
    measured: true,
  },
  {
    key: 'E5',
    pair: 'death animation hold before the next beat (min-only in v1)',
    min_ms: 1500,
    max_ms: 1500,
    source:
      'min+max D (the reference client blocks the die anim exactly 1500ms and the reference server holds 1500ms before the next turn — one flat hold, both legs; the trace asserts the min, a mob-slot last beat absorbs slack so max is unmeasurable there)',
    measured: true,
  },
  {
    key: 'E6',
    pair: 'walk cadence per cell',
    min_ms: 198,
    max_ms: 496,
    source:
      'D only (the vendored reference gait arrays: run 0.15 px/ms ≈ 198ms/cell on paths past 3 cells · walk 0.06 px/ms ≈ 496ms/cell at 3 or fewer — over the 29.74px board step; server budget 300ms/cell inside) · W fight move tween unsourced (IL2CPP)',
    measured: false,
  },
  {
    key: 'E7',
    pair: 'displacement (push/pull) slide per cell',
    min_ms: 119,
    max_ms: 119,
    source:
      'min+max D (the reference slide is a flat 0.25 px/ms over the 29.74px board step ≈ 119ms/cell, anim frozen — the 07-18 emulator re-read overturned the earlier "neither reference clocks displacement" claim)',
    measured: false,
  },
  {
    key: 'E8',
    pair: 'turn handoff (turn_end → next turn_start)',
    min_ms: 0,
    max_ms: 1000,
    source: 'min D (no banner — instant timeline swap) · max W (team-affiliation turn flash completes at 0.75+0.2s)',
    measured: true,
  },
  {
    key: 'E9',
    pair: 'turn banner hold',
    min_ms: null,
    max_ms: null,
    source: 'RULING-PENDING — D: 1.29 has no banner beat; W: banner timings live in IL2CPP code, unsourced',
    measured: false,
  },
  {
    key: 'E10',
    pair: 'mob turn presentation slot (turn_start → turn_end, non-local)',
    min_ms: 3000,
    max_ms: 4000,
    source:
      'min O (07-16 verbatim: "3s per mob turn, … alone against 6 mobs then it\'s 3x6" — the ledger\'s migrated number) · max derived (slot + 1s runtime grace)',
    measured: true,
  },
  {
    key: 'E11',
    pair: 'player end-turn floor (turn_start → END TURN enabled)',
    min_ms: 3000,
    max_ms: null,
    source:
      'min O ("paused for 3s then available" — ONE per-turn floor, per-cast re-arm banned; migrated ledger number) · max: none (the player thinks, bounded only by §7\'s 45s turn)',
    measured: false,
  },
  {
    key: 'E12',
    pair: 'dead-air cap (consecutive beat starts inside one non-local turn)',
    min_ms: null,
    max_ms: 3000,
    source:
      'max derived from E10 (no silent gap may swallow a whole mob slot; W max flow-hold 4.05s exceeds our slot — the slot wins)',
    measured: true,
  },
]

export const envelope = (key: string): EnvelopeRow => {
  const row = PACING_ENVELOPES.find((candidate) => candidate.key === key)
  if (!row) throw new Error(`unknown envelope row ${key}`)
  return row
}

export type PairMeasure = {
  readonly key: string
  readonly at_ms: number
  readonly interval_ms: number
  readonly actor: string | null
  readonly verdict: 'in' | 'below' | 'above'
}

export type OrderViolation = { readonly rule: string; readonly at_ms: number; readonly actor: string | null }
export type TeleportViolation = { readonly id: string; readonly at_ms: number }
export type TurnWindow = {
  readonly start_t: number
  readonly end_t: number | null
  readonly actor: 'mob' | 'local' | 'unknown'
}

export type PacingVerdict = {
  readonly measures: readonly PairMeasure[]
  readonly envelope_violations: readonly PairMeasure[]
  readonly order_violations: readonly OrderViolation[]
  readonly dead_air_violations: readonly PairMeasure[]
  readonly teleport_violations: readonly TeleportViolation[]
  readonly windows: readonly TurnWindow[]
}

const verdict_of = (interval_ms: number, row: EnvelopeRow): PairMeasure['verdict'] =>
  row.min_ms !== null && interval_ms < row.min_ms - JITTER_MS
    ? 'below'
    : row.max_ms !== null && interval_ms > row.max_ms + JITTER_MS
      ? 'above'
      : 'in'

const measure = (key: string, at_ms: number, interval_ms: number, actor: string | null): PairMeasure => ({
  key,
  at_ms,
  interval_ms,
  actor,
  verdict: verdict_of(interval_ms, envelope(key)),
})

const is_mob = (id: string | null) => /^mob-/.test(id ?? '')
/** Beat kinds whose probe row carries the ACTING entity id (cast/move) — the window classifier's evidence. */
const actor_kinds = new Set(['cast', 'move'])

/** Split the beat lane into turn windows at each `turn_start`; classify by the first acting id inside. */
const split_windows = (beats: readonly BeatTraceRow[]): readonly TurnWindow[] => {
  const starts = beats.filter((row) => row.kind === 'turn_start')
  return starts.map((start, index) => {
    const next_t = starts[index + 1]?.t ?? Number.POSITIVE_INFINITY
    const inside = beats.filter((row) => row.t >= start.t && row.t < next_t)
    const turn_end = inside.find((row) => row.kind === 'turn_end')
    const acting = inside.find((row) => actor_kinds.has(row.kind) && row.id !== null)
    return {
      start_t: start.t,
      end_t: turn_end?.t ?? null,
      actor: acting ? (is_mob(acting.id) ? 'mob' : 'local') : 'unknown',
    }
  })
}

/** One cast's group: every row from its swing (inclusive) to the next cast row (exclusive). */
const split_cast_groups = (rows: readonly BeatTraceRow[]) => {
  const casts = rows.filter((row) => row.lane === 'beat' && row.kind === 'cast')
  return casts.map((cast) => {
    const next_t = casts.find((candidate) => candidate.t > cast.t)?.t ?? Number.POSITIVE_INFINITY
    return { cast, rows: rows.filter((row) => row.t >= cast.t && row.t < next_t) }
  })
}

/**
 * The §7b conformance evaluator — pure verdicts over a merged probe trace (beats + vfx + upserts).
 * Grammar: no beat before its predecessor presents (order rules); envelopes: every measured beat-pair
 * interval inside its PACING_ENVELOPES row ± JITTER_MS; dead-air: E12 inside non-local turns only
 * (a player's thinking time between own actions is never dead air); teleport: no rig upsert strictly
 * inside a walk's move → arrival span (the "teleported me … then made me run" signature).
 */
export const evaluate_trace = (rows: readonly BeatTraceRow[]): PacingVerdict => {
  const trace = [...rows].sort((a, b) => a.t - b.t)
  const beats = trace.filter((row) => row.lane === 'beat')
  const windows = split_windows(beats)
  const groups = split_cast_groups(trace)

  const pair_measures = groups.flatMap(({ cast, rows: group }) => {
    const delivery = group.find((row) => row.lane === 'vfx' && row.id === cast.id && row.t >= cast.t)
    const floaters = group.filter((row) => row.lane === 'beat' && row.kind === 'damage' && row.t >= cast.t)
    const e1 = delivery ? [measure('E1', cast.t, delivery.t - cast.t, cast.id)] : []
    const e2 =
      delivery && floaters[0] && floaters[0].t >= delivery.t
        ? [measure('E2', delivery.t, floaters[0].t - delivery.t, cast.id)]
        : []
    const e3 = floaters
      .slice(1)
      .map((floater, index) => measure('E3', floaters[index]!.t, floater.t - floaters[index]!.t, floater.id))
    const e4 = group
      .filter((row) => row.lane === 'beat' && row.kind === 'death')
      .flatMap((death) => {
        const victim_floater = floaters.find((floater) => floater.id === death.id && floater.t <= death.t)
        return victim_floater ? [measure('E4', victim_floater.t, death.t - victim_floater.t, death.id)] : []
      })
    return [...e1, ...e2, ...e3, ...e4]
  })

  const order_violations = groups.flatMap(({ cast, rows: group }) => {
    const delivery = group.find((row) => row.lane === 'vfx' && row.id === cast.id && row.t >= cast.t)
    const floaters = group.filter((row) => row.lane === 'beat' && row.kind === 'damage')
    const inverted_floater =
      delivery && floaters[0] && floaters[0].t < delivery.t
        ? [{ rule: 'floater_before_vfx', at_ms: floaters[0].t, actor: cast.id }]
        : []
    const inverted_deaths = group
      .filter((row) => row.lane === 'beat' && row.kind === 'death')
      .flatMap((death) => {
        const victim_floater = floaters.find((floater) => floater.id === death.id)
        return victim_floater && death.t < victim_floater.t
          ? [{ rule: 'death_before_floater', at_ms: death.t, actor: death.id }]
          : []
      })
    return [...inverted_floater, ...inverted_deaths]
  })

  // E5 — the death hold: min-only (the report's max is the store watchdog's law; a mob-slot last beat absorbs
  // slack, so an above-verdict here would be noise). A death with no successor row is the trace's edge — skipped.
  const death_holds = beats
    .filter((row) => row.kind === 'death')
    .flatMap((death) => {
      const next = beats.find((row) => row.t > death.t)
      if (!next) return []
      const held = measure('E5', death.t, next.t - death.t, death.id)
      return held.verdict === 'above' ? [{ ...held, verdict: 'in' as const }] : [held]
    })

  const handoffs = beats
    .filter((row) => row.kind === 'turn_end')
    .flatMap((end) => {
      const next_start = beats.find((row) => row.kind === 'turn_start' && row.t > end.t)
      return next_start ? [measure('E8', end.t, next_start.t - end.t, null)] : []
    })

  const mob_windows = windows.filter((window) => window.actor === 'mob')
  const slots = mob_windows.flatMap((window) =>
    window.end_t !== null ? [measure('E10', window.start_t, window.end_t - window.start_t, 'mob')] : []
  )

  const dead_air_violations = mob_windows.flatMap((window) => {
    const inside = beats.filter((row) => row.t >= window.start_t && row.t <= (window.end_t ?? Number.POSITIVE_INFINITY))
    return inside
      .slice(1)
      .map((row, index) => measure('E12', inside[index]!.t, row.t - inside[index]!.t, row.id))
      .filter((gap) => gap.verdict === 'above')
  })

  const teleport_violations = beats
    .filter((row) => row.kind === 'move' && row.id !== null)
    .flatMap((move) => {
      const arrival = beats.find((row) => row.kind === 'arrival' && row.id === move.id && row.t >= move.t)
      if (!arrival) return []
      return trace
        .filter((row) => row.lane === 'upsert' && row.id === move.id && row.t > move.t && row.t < arrival.t)
        .map((snap) => ({ id: snap.id as string, at_ms: snap.t }))
    })

  const measures = [...pair_measures, ...death_holds, ...handoffs, ...slots]
  return {
    measures,
    envelope_violations: measures.filter((row) => row.verdict !== 'in'),
    order_violations,
    dead_air_violations,
    teleport_violations,
    windows,
  }
}
