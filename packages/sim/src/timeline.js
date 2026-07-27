// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TIMELINE — the deterministic fight-replay capsule: format, physics invariants, replay harness.
//
// A CAPSULE is a self-contained JSON record of one fight sequence: arena + raw spell templates +
// initial teams + the ordered command list + the expected outcome (full event stream + terminal
// digest). Capsules are the fixture format of the fight-replay gate AND the client recorder's
// export shape (a Sentry capsule replays through the exact same door). Replaying a capsule folds
// its commands through `reduce` and asserts three things:
//   1. PHYSICS — the invariant sweep holds from PLACEMENT onward: the initial state is swept before
//      any command, then every step (dead stays dead, occupancy exclusive…).
//   2. PARITY — events and terminal state match the committed expectation byte-for-byte.
//   3. DETERMINISM — two independent replays of the same capsule produce identical traces.
// A golden that changes is a deliberate act (regold + citation), never drift: the sim is pure, so
// any divergence is a rules change or a bug — the gate exists to make that distinction loud.
//
// PURE: no I/O here — capsule loading/writing lives with the callers (tests, CI, the recorder).

import { reduce, create_fight_state } from './reduce.js'
import { normalize_spell_templates } from './spell_templates.js'

/**
 * @typedef {object} Capsule
 * @property {{ id: string, class: string, authored: string, source: 'authored'|'sentry', notes?: string }} meta
 * @property {{ width: number, height: number, cells: number[], spawns_a: {x:number,y:number}[], spawns_b: {x:number,y:number}[] }} arena
 * @property {object} templates_raw raw spell templates (normalized at load)
 * @property {{ fight_id: string, arena_seed: number, team0: object[], team1: object[] }} initial
 * @property {object[]} commands ordered reducer commands, `start` included explicitly
 * @property {{x:number,y:number}[]} [pinned_move_path] independently hand-traced Move route, origin-exclusive
 * @property {{ events: object[], terminal_digest: string, terminal_summary: object }} [expected]
 */

/**
 * @typedef {object} ReplayStep
 * @property {number} index
 * @property {object} command
 * @property {object[]} events
 * @property {object} state state AFTER the command
 */

// ── Stable digest (key-sorted JSON + djb2) ───────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted recursively so identical values digest identically.
 * @param {unknown} value
 * @returns {string}
 */
export const stable_stringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable_stringify).join(',')}]`
  const keys = Object.keys(value).sort()
  const body = keys.map(
    key =>
      `${JSON.stringify(key)}:${stable_stringify(/** @type {Record<string, unknown>} */ (value)[key])}`,
  )
  return `{${body.join(',')}}`
}

/**
 * djb2 over the stable JSON — small, dependency-free, plenty for drift detection (parity failures
 * are diagnosed with the full expected/actual values, never from the hash alone).
 * @param {unknown} value
 * @returns {string}
 */
export const digest = value => {
  const text = stable_stringify(value)
  const hash = [...text].reduce(
    (acc, char) => (acc * 33) ^ char.charCodeAt(0),
    5381,
  )
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ── Physics invariants v1 · R2 tripwires ─────────────────────────────────────────
// Universal laws of any fight, independent of content — THEOREMS of the pure reducer, so a hit is a
// bug or a deliberate rules change, never noise. Each check looks at one transition (prev → next,
// with the command + events that caused it) and returns a { message, entities } violation or null.
// `check_tripwires` (below) runs the whole set and wraps each hit into a violation RECORD; the same
// set feeds the replay gate (`replay_capsule`) and the live client tap (recorder.js
// `observe_reduce_checked`) — one home for the laws, zero duplication (issue #63 · R2).
//   • dead_stays_dead   — damage floors health at 0 (fight_actions.js:116); no path revives hp<=0.
//   • hp_bounds         — damage clamps to 0, healing to health_max (fight_actions.js:116,167).
//   • occupancy_exclusive — make_is_walkable forbids a cell held by another living actor (reduce.js:126).
//   • winner_terminal   — with_victory latches the winner; a concluded fight is never re-decided (reduce.js:152).
//   • change_has_cause  — THE MASTER RULE: reduce returns `events: []` ONLY on guard/no-op paths that
//                         return the UNCHANGED input state (reduce.js:229,235,410,415,478…), so any
//                         state change is named by ≥1 event (0 causeless steps across the corpus).

/** @param {object} state @returns {object[]} */
const all_entities = state => [...state.team0, ...state.team1]

/**
 * @typedef {object} Violation
 * @property {string} message  human-readable breach description
 * @property {string[]} entities  ids of the entities implicated (may be empty)
 */

/** @type {{ id: string, check: (prev: object, next: object, command: object, events: object[]) => Violation | null }[]} */
export const PHYSICS_INVARIANTS = [
  {
    id: 'dead_stays_dead',
    check: (prev, next) => {
      const risen = all_entities(prev)
        .filter(entity => entity.health <= 0)
        .find(entity => {
          const after = all_entities(next).find(e => e.id === entity.id)
          return after !== undefined && after.health > 0
        })
      return risen
        ? {
            message: `entity ${risen.id} was dead (hp<=0) and re-entered alive`,
            entities: [risen.id],
          }
        : null
    },
  },
  {
    id: 'hp_bounds',
    check: (prev, next) => {
      const out = all_entities(next).find(
        entity => entity.health < 0 || entity.health > entity.health_max,
      )
      return out
        ? {
            message: `entity ${out.id} health ${out.health} outside [0, ${out.health_max}]`,
            entities: [out.id],
          }
        : null
    },
  },
  {
    id: 'occupancy_exclusive',
    check: (prev, next) => {
      const living = all_entities(next).filter(entity => entity.health > 0)
      const seen = living.reduce(
        (acc, entity) => {
          const key = `${entity.cell.x},${entity.cell.y}`
          const held = acc.cells[key]
          return {
            clash:
              acc.clash ??
              (held
                ? {
                    message: `cell ${key} holds ${held} AND ${entity.id}`,
                    entities: [held, entity.id],
                  }
                : null),
            cells: { ...acc.cells, [key]: entity.id },
          }
        },
        {
          clash: /** @type {Violation|null} */ (null),
          cells: /** @type {Record<string,string>} */ ({}),
        },
      )
      return seen.clash
    },
  },
  {
    id: 'winner_terminal',
    check: (prev, next) =>
      prev.winner !== -1 && next.winner !== prev.winner
        ? {
            message: `winner changed ${prev.winner} -> ${next.winner} after conclusion`,
            entities: [],
          }
        : null,
  },
  {
    id: 'change_has_cause',
    check: (prev, next, command, events) =>
      digest(prev) !== digest(next) && events.length === 0
        ? {
            message: `state changed with no event naming the cause (command ${command?.type ?? '?'})`,
            entities: [],
          }
        : null,
  },
]

/**
 * Run every physics invariant over ONE transition and return a VIOLATION RECORD per breach: the rule
 * id, the implicated entity ids, the human message, and an EVIDENCE digest of the causing transition
 * (command + events) — the fingerprint R3/R4 use to snip the surrounding window into a travelling
 * capsule. Pure and TOTAL: a violation is DATA recorded for later reporting, never an exception
 * thrown into a game path. Shared by `replay_capsule` (the gate) and the live tap — the one place the
 * laws run.
 * @param {object} prev  state BEFORE the command
 * @param {object} next  state AFTER the command
 * @param {object} command  the reducer command that caused the transition
 * @param {object[]} [events]  the events reduce() emitted for it
 * @returns {{ rule: string, entities: string[], message: string, evidence: string }[]}
 */
export const check_tripwires = (prev, next, command, events = []) => {
  const evidence = digest({ command, events })
  return PHYSICS_INVARIANTS.flatMap(invariant => {
    const hit = invariant.check(prev, next, command, events)
    return hit === null
      ? []
      : [
          {
            rule: invariant.id,
            entities: hit.entities,
            message: hit.message,
            evidence,
          },
        ]
  })
}

// ── Capsule replay ───────────────────────────────────────────────────────────────

/**
 * Revive the JSON arena into the reducer's shape (Uint8Array cells, derived radius/center).
 * @param {Capsule['arena']} arena
 */
export const revive_arena = arena => ({
  width: arena.width,
  height: arena.height,
  radius: (arena.width - 1) / 2,
  center: { x: (arena.width - 1) / 2, y: (arena.height - 1) / 2 },
  cells: Uint8Array.from(arena.cells),
  spawns_a: arena.spawns_a,
  spawns_b: arena.spawns_b,
})

/**
 * Human-diffable terminal summary: entity vitals + the winner. The digest proves byte parity; the
 * summary tells a human WHAT moved when it breaks.
 * @param {object} state
 */
export const terminal_summary = state => ({
  winner: state.winner,
  turn_number: state.turn_number,
  entities: all_entities(state).map(entity => ({
    id: entity.id,
    health: entity.health,
    cell: entity.cell,
  })),
})

/**
 * Fold a capsule's commands through the reducer, sweeping physics invariants over the INITIAL state and then
 * at every transition. Pure — no assertions, no I/O; callers judge the returned record.
 * @param {Capsule} capsule
 * @returns {{ steps: ReplayStep[], events: object[], terminal: object, violations: string[], trace_digest: string }}
 */
export const replay_capsule = capsule => {
  const arena = revive_arena(capsule.arena)
  const ctx = {
    spell_templates: normalize_spell_templates(capsule.templates_raw),
    arena,
  }
  const initial = create_fight_state({
    fight_id: capsule.initial.fight_id,
    arena_seed: capsule.initial.arena_seed,
    arena_radius: arena.radius,
    arena,
    team0: capsule.initial.team0,
    team1: capsule.initial.team1,
  })
  // STEP ZERO (#1218). The laws are properties of a STATE, not of a step, so the placement snapshot gets the
  // same sweep every later state gets — run as a SELF-transition (prev === next, no events), which the two
  // transition-shaped rules read as a no-op by construction: nothing rose, nothing changed, no winner moved.
  // Without it a fight that BEGINS illegally — two living fighters on one cell, the shape reported in #1218 —
  // replayed clean until something happened to move somebody, and a capsule with no commands never checked at
  // all. One law, one home; the start is no longer a blind spot.
  const start_violations = check_tripwires(
    initial,
    initial,
    { type: 'start' },
    [],
  ).map(violation => `[${violation.rule}] start: ${violation.message}`)
  const folded = capsule.commands.reduce(
    (acc, command, index) => {
      const { state, events } = reduce(acc.state, command, ctx)
      const violations = check_tripwires(acc.state, state, command, events).map(
        violation =>
          `[${violation.rule}] step ${index} (${command.type}): ${violation.message}`,
      )
      return {
        state,
        steps: [...acc.steps, { index, command, events, state }],
        violations: [...acc.violations, ...violations],
      }
    },
    {
      state: initial,
      steps: /** @type {ReplayStep[]} */ ([]),
      violations: /** @type {string[]} */ (start_violations),
    },
  )
  return {
    steps: folded.steps,
    events: folded.steps.flatMap(step => step.events),
    terminal: folded.state,
    violations: folded.violations,
    trace_digest: digest(
      folded.steps.map(step => ({
        command: step.command,
        events: step.events,
      })),
    ),
  }
}

/**
 * Author/refresh a capsule's expectation from an actual replay — the REGOLD path. Refuses to bless
 * a physics violation: a poisoned golden is worse than none.
 * @param {Capsule} capsule
 * @returns {Capsule}
 */
export const record_expectation = capsule => {
  const replay = replay_capsule(capsule)
  if (replay.violations.length > 0)
    throw new Error(
      `refusing to record a golden over physics violations:\n${replay.violations.join('\n')}`,
    )
  return {
    ...capsule,
    expected: {
      events: replay.events,
      terminal_digest: digest(replay.terminal),
      terminal_summary: terminal_summary(replay.terminal),
    },
  }
}
