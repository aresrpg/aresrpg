// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/assert.js — THE POINT OF THE BOT (#1100). Every action the policy planned is checked against the
// FOLDED TRUTH of the turn it committed: damage dealt, AP spent, cells moved, statuses applied, a push's
// distance AND direction. An action that reports `ok: true` without its delta produces a FAIL row here, not
// a warning — "the tx succeeded" has never been evidence that the game did anything.
//
// PURE, and deliberately blind to the browser: it takes the two `__ARES_DEV_READ()` snapshots the seam took
// either side of the commit. Every number it reads is the COMMITTED fold (`*_committed`), never the
// presented one — the eye's HP ticks with the vfx and the eye's cell holds through the walk beat, so
// asserting on those would be asserting on an animation clock.
//
// AND ONE ROW THAT READS SOMETHING ELSE (#1144). Committed-vs-committed proves the turn did something; it can
// never prove the game did what the PLAYER WAS SHOWN — a cast that predicts 2 HP and kills passes every row
// above. `assert_prediction` compares the seam's PREDICTION BANK (the client's own `predict_cast`, recorded
// before the authority was asked) against the committed fold, which makes every bot drive a live parity sweep.

import { get_direction } from '@aresrpg/sim/fight_displacement'

import { cell_index } from './read.js'

const find = (read, id) => read?.fighters?.find((f) => f.id === id) ?? null
const same_cell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y

/** Cells print as `x,y`; everything else prints as itself. A sheet full of `[object Object]` proves nothing. */
const fmt = (value) =>
  value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? `${value.x},${value.y}`
    : String(value)

const row = (index, action, check, expected, actual, pass, note = '') => ({
  index,
  kind: action?.kind === 0 ? 'move' : action?.kind === 1 ? `cast:${action.spell_key ?? action.spell_id}` : 'turn',
  at: action?.cell ?? null,
  check,
  expected: fmt(expected),
  actual: fmt(actual),
  pass,
  note,
})

/** Steps `moved` travelled from `from` along `dir`, or null when it left that ray. */
const steps_along = (from, moved, dir) => {
  if (dir.dx === 0 && dir.dy === 0) return null
  const dx = moved.x - from.x
  const dy = moved.y - from.y
  if (dir.dx !== 0) return dy === 0 && Math.sign(dx) === dir.dx ? Math.abs(dx) : null
  return dx === 0 && Math.sign(dy) === dir.dy ? Math.abs(dy) : null
}

// THE TWO CLOCKS, and which fact reads which.
//
// POSITION, HP and LIFE are chain truth and read the COMMITTED fold (`*_committed`): settled the instant the
// receipt folds, owing nothing to an animation.
//
// AP and MP DO NOT PUBLISH A LEFTOVER on a committed turn — MEASURED, not assumed (fight_bot_sheet's `pools`
// block: across a 6-turn run every read either side of every commit showed ap 6 → 6, and mp moved ONLY by the
// +1 a GIVE_POINTS buff granted, never by the 3 MP a walk had just spent). The post-commit read already shows
// the NEXT turn's refilled budget, so "AP spent" is not an observable on this surface at all. Asserting a
// delta against it would be asserting a number nobody publishes, which is how a harness starts lying.
// So the budget is checked where it IS truth — at turn start, against the plan — and the unobservable
// leftover is a filed gap, never a fabricated pass.
const budget_ap = (fighter) => Number(fighter?.ap ?? fighter?.ap_committed ?? 0)
const budget_mp = (fighter) => Number(fighter?.mp ?? fighter?.mp_committed ?? 0)

const assert_move = (index, action, before, after) => {
  const me_before = find(before, before.my_id)
  const me_after = find(after, after.my_id)
  const landed = same_cell(me_after?.cell_committed, action.cell)
  const budget = budget_mp(me_before)
  return [
    row(
      index,
      action,
      'the seat stands on the cell it moved to',
      action.cell,
      me_after?.cell_committed ?? null,
      landed
    ),
    row(
      index,
      action,
      'the walk fitted the MP the seat had',
      `≤ ${budget} MP`,
      `${action.expect.mp_cost} MP`,
      action.expect.mp_cost <= budget,
      'the leftover pool is not published post-commit — the CELL row above is this action’s delta'
    ),
  ]
}

/**
 * THE PARITY ORACLE (#1144) — the one row in this file that compares OUR MATH against THE AUTHORITY instead of
 * comparing the authority against itself. Every other row here reads `*_committed` on both sides, which is chain
 * truth measured against chain truth: it proves the turn did something, never that the game did what the player
 * was shown. The client's predicted post-cast HP is the only fact a post-commit read cannot recover, so the seam
 * BANKS it before staging (`dev_bot_seam.bank_predictions`) and this compares it to the committed fold.
 *
 * ONLY THE PLANNED TARGET IS ASSERTED. Each bank is predicted from the PRE-TURN view while the committed fold
 * accumulates every action of the turn, so a fighter two casts both touch would be compared against a state the
 * first prediction never claimed. The policy's harness rule gives every action a distinct assertable fact, which
 * makes the planned target — and only it — a fair comparison. Collateral predictions ride the sheet unasserted.
 *
 * AND NEVER THE SEAT ITSELF — the window's one MEASURED limit. A committed turn closes with `act_pass` and the
 * authority resolves the OPPONENTS' turn inside the same commit, so the post-commit fold already carries their
 * reply: the first drive of this oracle "found" the seat losing 5 HP no prediction claimed, which was a mob
 * hitting back, not a divergence. Anything the enemy reliably moves is therefore outside what a pre-turn
 * prediction can be graded against, and asserting on it would make this gate lie in the other direction.
 * A trap of the seat's own springing on the enemy inside that same window is the residual noise source; it is
 * visible in the sheet beside its own spring row, never silently folded into this one.
 *
 * AN UNRESOLVED PREDICTION IS A GAP, NOT A PASS. A <100% chance row or a not-yet-deployed chain kind has no
 * deterministic number to compare, so no row is fabricated here; `assert_prediction_proofs` reports the count and
 * the reasons at run level, and a run that resolved NOTHING fails there rather than passing quietly here.
 * @returns {Array<object>} zero or one row
 */
const assert_prediction = (index, action, banked, before, after) => {
  const target_id = action.expect?.target_id
  if (!banked || !target_id || target_id === before?.my_id) return []
  const rank = `${banked.spell_key ?? banked.spell_id} rank ${banked.spell_level}`
  const predicted = (banked.hp ?? []).find((row) => row.id === target_id)
  const committed = Number(find(after, target_id)?.hp_committed ?? Number.NaN)
  const build = `predicted with ${JSON.stringify(banked.caster_build?.stats ?? {})} at level ${banked.caster_build?.level ?? '?'}`
  // A cast that claimed no HP for its target (a buff, a trap placement, an unresolved row) has no number to
  // grade — the run-level tally counts it, and the action's own delta row above owns whether it did anything.
  if (!predicted) return []
  return [
    row(
      index,
      action,
      `the authority resolved the HP the client predicted for ${target_id}`,
      `${predicted.remaining_hp} hp (${rank})`,
      `${committed} hp (committed fold)`,
      Number(predicted.remaining_hp) === committed,
      `PREDICTION↔AUTHORITY · ${build}`
    ),
  ]
}

const assert_damage = (index, action, before, after) => {
  const target_before = find(before, action.expect.target_id)
  const target_after = find(after, action.expect.target_id)
  const dealt = Number(target_before?.hp_committed ?? 0) - Number(target_after?.hp_committed ?? 0)
  const rows = [
    row(index, action, 'the target lost HP', `≥ ${action.expect.min_damage}`, dealt, dealt >= action.expect.min_damage),
  ]
  if (action.expect.kill)
    rows.push(
      row(
        index,
        action,
        'a lethal cast kills the target',
        'dead',
        target_after?.alive_committed ? 'alive' : 'dead',
        !target_after?.alive_committed
      )
    )
  return rows
}

const assert_heal = (index, action, before, after) => {
  const target_before = find(before, action.expect.target_id)
  const target_after = find(after, action.expect.target_id)
  const healed = Number(target_after?.hp_committed ?? 0) - Number(target_before?.hp_committed ?? 0)
  return [row(index, action, 'the target gained HP', '≥ 1', healed, healed >= 1)]
}

/**
 * THE PUSH ROW — the one the ruling names explicitly. The target's cell must have moved along the cardinal
 * the sim derives (`get_direction`, the `combat_grid::away_dir` twin) by the authored number of cells; a
 * SHORT push is legal ONLY when something stopped it, and the sim charges collision damage when it does. So
 * a short push with no HP loss is a FAIL — that is exactly the silent no-op this bot exists to catch.
 */
const assert_push = (index, action, before, after) => {
  const target_before = find(before, action.expect.target_id)
  const target_after = find(after, action.expect.target_id)
  const from = target_before?.cell_committed
  const to = target_after?.cell_committed
  const dir = get_direction(action.expect.from, from ?? { x: 0, y: 0 })
  const moved = from && to ? steps_along(from, to, dir) : null
  const wanted = action.expect.cells
  const collided = Number(target_before?.hp_committed ?? 0) > Number(target_after?.hp_committed ?? 0)
  const rows = [
    row(
      index,
      action,
      'the target moved along the push direction',
      `${wanted} cell(s) ${dir.dx ? (dir.dx > 0 ? 'east' : 'west') : dir.dy > 0 ? 'south' : 'north'} from ${from?.x},${from?.y}`,
      to ? `${to.x},${to.y} (${moved == null ? 'off the push ray' : `${moved} cell(s)`})` : 'unknown',
      moved != null && moved >= 1 && moved <= wanted
    ),
  ]
  if (moved != null && moved < wanted)
    rows.push(
      row(
        index,
        action,
        'a short push collided (and therefore hurt)',
        'HP lost on impact',
        collided ? 'HP lost' : 'no HP lost',
        collided,
        `pushed ${moved} of ${wanted} cells`
      )
    )
  return rows
}

const assert_status = (index, action, before, after) => {
  const target_before = find(before, action.expect.target_id)
  const target_after = find(after, action.expect.target_id)
  const before_kinds = (target_before?.effects ?? []).map((e) => Number(e.kind))
  const after_kinds = (target_after?.effects ?? []).map((e) => Number(e.kind))
  const gained = after_kinds.length - before_kinds.length
  const rows = [row(index, action, 'a status row appeared on the target', '≥ 1 new status', gained, gained >= 1)]
  for (const kind of action.expect.kinds ?? [])
    rows.push(
      row(
        index,
        action,
        `the ${kind} status is riding the target`,
        `kind ${kind} present`,
        after_kinds.join(',') || 'none',
        after_kinds.includes(Number(kind))
      )
    )
  return rows
}

/**
 * A TRAP HAS NO PLACEMENT OBSERVABLE for a seam-committed cast — also measured. `my_traps` is the client's
 * LOCAL durable ledger (fold.js: "the local-only durable trap ledger") and its ONLY writer is the board's
 * OPTIMISTIC draft path (DungeonBoard `optimistic_cast` → `input({ type:'predicted', place_traps })`); the
 * receipt carries no trap row, so a trap committed through the seam is invisible client-side even though the
 * sim holds it (proven: the sim then REFUSED a second trap on the same cell — the authority knew, the client
 * did not). So placement asserts what the authority itself answered — it accepted a `free_cell` cast the sim
 * gates on occupancy, terrain AND a live trap — and the trap's REAL proof is deferred to `assert_traps_sprung`
 * below, which watches for the detonation.
 */
const assert_trap = (index, action, before, after) => {
  const at = action.expect.cell
  const standing = (after.fighters ?? []).find(
    (f) => f.alive_committed && f.cell_committed?.x === at.x && f.cell_committed?.y === at.y
  )
  return [
    row(
      index,
      action,
      'the authority accepted the trap on a free cell',
      `${at.x},${at.y} free and untrapped`,
      standing ? `${standing.id} stands there` : 'accepted',
      !standing,
      'placement is not published client-side — the spring row (below, on a later turn) is this trap’s delta'
    ),
  ]
}

/**
 * THE TRAP'S ACTUAL PROOF — a deferred, cross-turn assertion. A trap only means something when something
 * walks into it, so the runner carries the cells it armed and this checks, each turn, whether a living enemy
 * has ENTERED one: if it did, it must have paid for it. A fighter standing on a trapped cell at full health
 * is exactly the silent no-op this bot exists to catch.
 * @param {Array<{ cell: { x: number, y: number }, turn: number, spell_key: string }>} armed
 * @param {object} before @param {object} after the reads either side of the turn just committed
 * @returns {{ rows: Array<object>, remaining: Array<object> }}
 */
export const assert_traps_sprung = (armed, before, after) => {
  const rows = []
  const remaining = []
  for (const trap of armed) {
    const on_it = (read) =>
      (read.fighters ?? []).find(
        (f) => f.id !== read.my_id && f.cell_committed?.x === trap.cell.x && f.cell_committed?.y === trap.cell.y
      )
    const entered = on_it(after)
    if (!entered || on_it(before)?.id === entered.id) {
      remaining.push(trap)
      continue
    }
    const was = find(before, entered.id)
    const hurt = Number(was?.hp_committed ?? 0) - Number(find(after, entered.id)?.hp_committed ?? 0)
    rows.push(
      row(
        0,
        { kind: 1, spell_key: trap.spell_key, cell: trap.cell },
        `the trap armed on turn ${trap.turn} sprang when ${entered.id} stepped on it`,
        'HP lost on entry',
        hurt,
        hurt >= 1
      )
    )
  }
  return { rows, remaining }
}

/**
 * THE CROSS-CLIENT PROOF (#1100 coop) — the one fact a single-page bot structurally cannot check: that what
 * seat A's turn did is TRUE ON SEAT B's SCREEN. Two browsers hold two independent folds of the same chain
 * fight; a status applied on one and missing on the other is a desync no per-page assertion can see, because
 * each page is individually self-consistent.
 *
 * Two rows per checked fact, on purpose:
 *   FOLD — every fighter the turn touched (the actor and each action's target) must carry the SAME committed
 *          HP, cell and life on the observer's page. Committed values only: the observer is mid-replay of the
 *          same beats, so its PRESENTED numbers are legitimately behind and asserting on them would be
 *          asserting on the observer's animation clock.
 *   STATUS — a cast whose whole delta is a status row (a buff on an ally, a debuff on an enemy) must show that
 *          row riding the same fighter on the observer's page. This is the proof the ruling names: a buff seat
 *          A casts is visible from seat B.
 *
 * @param {{ actions: Array<object> }} plan what the acting seat decided
 * @param {{ ok: boolean, after?: object }} result what its seam committed
 * @param {object} observer another seat's `__ARES_DEV_READ()`, taken after the commit settled there
 * @returns {{ rows: Array<object>, status_proofs: number }}
 */
export const assert_cross_client = (plan, result, observer) => {
  // A refused turn has nothing to be visible: `assert_turn` already owns that failure, and adding a second
  // FAIL row for the same fact would inflate the sheet instead of informing it.
  if (!result.ok || !result.after) return { rows: [], status_proofs: 0 }
  if (!observer?.ok)
    return {
      rows: [
        row(
          0,
          null,
          'the other client still holds the fight',
          'a readable fight',
          observer?.error ?? 'no read',
          false,
          'cross-client — an observer that cannot read the fight proves nothing about it'
        ),
      ],
      status_proofs: 0,
    }
  const mine = result.after
  const watched = new Set([mine.my_id, ...plan.actions.map((a) => a.expect?.target_id).filter(Boolean)])
  const rows = []
  for (const id of watched) {
    const here = find(mine, id)
    const there = find(observer, id)
    if (!here) continue
    rows.push(
      row(
        0,
        null,
        `the other client folds ${id} to the same committed truth`,
        !there
          ? 'the fighter exists on both pages'
          : `hp ${here.hp_committed} · ${fmt(here.cell_committed)} · ${here.alive_committed ? 'alive' : 'dead'}`,
        !there
          ? 'absent from the observer’s read'
          : `hp ${there.hp_committed} · ${fmt(there.cell_committed)} · ${there.alive_committed ? 'alive' : 'dead'}`,
        !!there &&
          Number(there.hp_committed) === Number(here.hp_committed) &&
          same_cell(there.cell_committed, here.cell_committed) &&
          !!there.alive_committed === !!here.alive_committed,
        'cross-client — the committed fold, never the observer’s presented one'
      )
    )
  }
  let status_proofs = 0
  for (const [index, action] of plan.actions.entries()) {
    if (action.expect?.type !== 'status') continue
    const there = find(observer, action.expect.target_id)
    const kinds = (there?.effects ?? []).map((e) => Number(e.kind))
    for (const kind of action.expect.kinds ?? []) {
      status_proofs += 1
      rows.push(
        row(
          index,
          action,
          `the status cast on ${action.expect.target_id} is visible from the other client`,
          `kind ${kind} present`,
          kinds.join(',') || 'none',
          kinds.includes(Number(kind)),
          'cross-client status visibility'
        )
      )
    }
  }
  return { rows, status_proofs }
}

/**
 * A coop run must actually EXERCISE the cross-client status proof, not merely be capable of it. Zero status
 * casts across a whole fight is a run that proved nothing about status visibility, so it says so as a FAIL
 * with the reason — never a silent pass, and never a skip dressed as one.
 * @param {number} status_proofs how many status rows the run checked across clients
 * @param {string} why the honest reason none fired (the seats' books, at their level)
 */
export const assert_status_proof_ran = (status_proofs, why) => [
  row(
    0,
    null,
    'the coop run landed at least one cross-client status proof',
    '≥ 1 status row observed from the other client',
    status_proofs || `0 — ${why}`,
    status_proofs >= 1
  ),
]

const ACTION_ASSERTIONS = {
  move: assert_move,
  damage: assert_damage,
  heal: assert_heal,
  push: assert_push,
  status: assert_status,
  trap: assert_trap,
}

/**
 * THE RUN'S OWN PARITY ROW (#1144) — the same shape the coop status proof takes, for the same reason: a rig that
 * CAN compare prediction to chain and never did has proven nothing about parity, and a sheet that reports PASS on
 * that is exactly the disease this oracle was built to cure (a gate structurally incapable of failing). Zero
 * resolved comparisons is a FAIL that names why, never a silent pass.
 * @param {{ checked: number, unresolved: Array<string> }} tally
 * @returns {Array<object>}
 */
export const assert_prediction_proofs = ({ checked = 0, unresolved = [] } = {}) => [
  row(
    0,
    null,
    'the run compared at least one prediction against the authority',
    '≥ 1 resolved prediction↔chain comparison',
    checked || `0 — ${unresolved.length ? `every cast was unpredictable (${[...new Set(unresolved)].join(', ')})` : 'the surface banked no predictions (an old build, or no cast landed)'}`,
    checked >= 1,
    unresolved.length ? `${[...new Set(unresolved)].length} unresolved reason(s): ${[...new Set(unresolved)].join(', ')}` : ''
  ),
]

/** The parity tally a run accumulates from one turn's banks — `checked` counts exactly the comparisons
 *  `assert_prediction` actually graded (never a self-target: see its header on the commit window). */
export const prediction_tally = (plan, result) => {
  const banks = result?.predicted ?? []
  const me = result?.before?.my_id ?? null
  const targets = new Map(plan.actions.map((action, index) => [index, action.expect?.target_id ?? null]))
  return {
    checked: banks.filter((bank) => {
      const target = targets.get(bank.index)
      return !!target && target !== me && (bank.hp ?? []).some((row) => row.id === target)
    }).length,
    unresolved: banks.flatMap((bank) => bank.unresolved ?? []),
  }
}

/**
 * Check ONE committed turn. Returns one row per checked fact — `pass:false` rows are failures, never
 * warnings.
 * @param {{ actions: Array<object> }} plan what the policy decided
 * @param {{ ok: boolean, error?: string, before: object, after: object, predicted?: Array<object> }} result
 *   what the seam committed, plus the prediction bank it took before staging (see `assert_prediction`)
 * @returns {Array<object>}
 */
export const assert_turn = (plan, result) => {
  if (!result.ok)
    return [
      row(
        0,
        null,
        'the turn committed',
        'ok',
        result.error ?? 'refused',
        false,
        'every action assertion is moot — the turn never landed'
      ),
    ]
  const { before, after } = result
  const banked = new Map((result.predicted ?? []).map((bank) => [bank.index, bank]))
  const rows = plan.actions.flatMap((action, index) => {
    const check = ACTION_ASSERTIONS[action.expect?.type]
    return check
      ? [...check(index, action, before, after), ...assert_prediction(index, action, banked.get(index), before, after)]
      : [
          row(
            index,
            action,
            'the bot knows how to check this action',
            'a known expectation type',
            action.expect?.type ?? 'none',
            false
          ),
        ]
  })
  // THE BUDGET ROW — actions commit as one batch, so AP is the turn's own fact, not any single cast's. It
  // reads the turn-start budget (see the two-clocks note): a batch over budget is refused by the authority,
  // so "planned within budget AND accepted" is the whole observable AP truth this surface publishes.
  const budget = budget_ap(find(before, before.my_id))
  const billed = plan.actions.reduce((sum, a) => sum + Number(a.ap_cost ?? 0), 0)
  return [
    ...rows,
    row(
      plan.actions.length,
      null,
      'the committed casts fitted the AP the seat had',
      `≤ ${budget} AP`,
      `${billed} AP`,
      billed <= budget,
      'the leftover pool is not published post-commit — an over-budget batch is refused by the authority'
    ),
  ]
}

/** A run's rows → the machine-readable verdict the sheet carries. */
export const summarise = (rows) => ({
  checks: rows.length,
  passed: rows.filter((r) => r.pass).length,
  failed: rows.filter((r) => !r.pass).length,
  verdict: rows.some((r) => !r.pass) ? 'FAIL' : 'PASS',
})
