// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/policy.js — THE SCRIPTED FIGHT BOT'S BRAIN (#1100). A PURE function: one `__ARES_DEV_READ()` snapshot
// in, one turn's worth of actions out, plus the DECISION LIST that shows why. No browser, no store, no
// clock, no RNG — which is what makes it unit-testable headlessly and replayable from a seed.
//
// It plays like a player, not like a macro: it reads AP/MP, the spell book (costs, ranges, effects), mob
// positions and HP, the board mask and live statuses; it repositions to unlock the best cast (and REFUSES to
// disengage from an adjacent body, because that is a tackle); it buffs itself only when the buff is not
// already up; it drops traps on the approach path; it pushes; and it spends its AP greedily on the highest
// VALUE legal cast until nothing pays.
//
// GREEDY, ON PURPOSE. A search would be a better player and a worse instrument: every turn must be
// explainable in one line, because the point of this bot is that a FAIL row is trustworthy. Value weights
// live in ONE table below — the only tuning surface.
//
// THE ONE HARNESS CONSTRAINT (and why it exists): a planned turn never contains two actions claiming the
// SAME assertable fact (two casts on one target's HP, two traps on one cell, …). Turns commit as one batch —
// the chain closes every turn with `act_pass` — so per-action truth is only separable when each action owns
// a distinct fact. This costs the bot a little damage per turn and buys every FAIL row its meaning.

import { get_direction } from '@aresrpg/sim/fight_displacement'

import { cap_of, on_cooldown, target_cap_reached } from '../draft_budget.js'

import {
  allies_of,
  cell_index,
  enemies_of,
  landing_effects,
  living,
  manhattan,
  me_of,
  path_cost,
  reachable_cells,
  spell_reaches,
  status_signature,
} from './read.js'

/** The value table — the bot's whole taste, in one place. Units are "points of expected HP swing". */
export const WEIGHTS = {
  /** a kill is worth more than the damage that produced it: it removes a whole future turn from the enemy */
  kill: 500,
  /** a damage-over-time tick is real but deferred and dispellable */
  dot: 0.8,
  /** one cell of push — displacement is tempo, and a shove into a wall is free damage */
  push_per_cell: 12,
  /** a trap only pays if something walks into it; half a hit, and only on a real approach path */
  trap: 0.5,
  /** a buff's value scales with how long it rides */
  buff_per_turn: 4,
  /** healing above the target's missing HP is wasted, so this only ever weights the useful part */
  heal: 1,
  /** below this, an action is not worth an AP */
  floor: 1,
}

/** Effect kinds (fight-spells-core `kind_names`) the bot understands. Anything else scores ZERO — the bot
 *  never claims value it could not then assert. */
const DAMAGE_KINDS = new Set(['DAMAGE', 'PERCENT_LIFE', 'LIFE_STEAL', 'PUNISHMENT', 'CASTER_DAMAGE'])
const BUFF_KINDS = new Set([
  'ALTER_STAT',
  'GIVE_POINTS',
  'REDUCE_DAMAGE',
  'APPLY_STATE',
  'REFLECT_DAMAGE',
  'ALTER_RESIST',
  // #1874 — INVISIBILITY (kind 27) is a self-buff like any other: it rides `buff_per_turn` and the
  // already-up check. Missing here it matched NO scoring branch at all, so a Vanish in the book scored
  // null and the bot could never cast it — a silent hole in the instrument, not a decision it made.
  'INVISIBILITY',
])
const DEBUFF_KINDS = new Set(['REMOVE_POINTS', 'STEAL_POINTS', 'STEAL_STAT', 'EROSION'])
const PUSH_KINDS = new Set(['PUSH', 'GEOMETRIC_PUSH'])

/** A deterministic 32-bit hash — the seed's ONLY job: break exact-value ties the same way on every replay. */
const tie_break = (seed, key) => {
  let h = (seed >>> 0) ^ 0x9e3779b9
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/** Damage the effects of `spell` are authored to deal to one enemy (base values — the sim rolls the rest). */
const damage_of = (effects) =>
  effects.reduce((sum, e) => {
    if (DAMAGE_KINDS.has(e.kind)) return sum + Number(e.base ?? 0)
    if (e.kind === 'APPLY_DOT') return sum + Number(e.base ?? 0) * Math.max(1, Number(e.turns ?? 1)) * WEIGHTS.dot
    return sum
  }, 0)

/**
 * Score one (spell → fighter) pairing and name the ONE fact the assertion will own. Returns null when the
 * pairing is worthless (never negative — the bot simply does not consider self-harm).
 */
const score_on_fighter = (spell, caster, target) => {
  const is_caster = caster.id === target.id
  const effects = landing_effects(spell, { is_caster, same_team: caster.team === target.team })
  if (!effects.length) return null
  const enemy = caster.team !== target.team

  const damage = enemy ? damage_of(effects) : 0
  if (damage > 0) {
    const kill = damage >= Number(target.hp_committed)
    return {
      value: damage + (kill ? WEIGHTS.kill : 0),
      fact: `hp:${target.id}`,
      expect: { type: 'damage', target_id: target.id, min_damage: 1, kill },
    }
  }

  const push = effects.find((e) => PUSH_KINDS.has(e.kind))
  if (push && enemy) {
    const cells = Math.max(1, Number(push.base ?? 1))
    return {
      value: cells * WEIGHTS.push_per_cell,
      fact: `cell:${target.id}`,
      expect: { type: 'push', target_id: target.id, cells },
    }
  }

  const heal = effects.filter((e) => e.kind === 'HEAL')
  if (heal.length && !enemy) {
    const missing = Math.max(0, Number(target.hp_max) - Number(target.hp_committed))
    const healed = Math.min(
      missing,
      heal.reduce((sum, e) => sum + Number(e.base ?? 0), 0)
    )
    if (healed <= 0) return null // a full-HP target is not a heal target — that is the "when it pays" rule
    return { value: healed * WEIGHTS.heal, fact: `hp:${target.id}`, expect: { type: 'heal', target_id: target.id } }
  }

  const status = effects.filter((e) => (enemy ? DEBUFF_KINDS.has(e.kind) : BUFF_KINDS.has(e.kind)))
  if (status.length) {
    // ALREADY UP ⇒ WORTHLESS. Re-casting a live buff spends AP for no delta, and would assert nothing.
    const live_kinds = new Set((target.effects ?? []).map((e) => Number(e.kind)))
    const fresh = status.filter((e) => e.kind_id == null || !live_kinds.has(Number(e.kind_id)))
    if (!fresh.length) return null
    const value = fresh.reduce((sum, e) => sum + Math.max(1, Number(e.turns ?? 1)) * WEIGHTS.buff_per_turn, 0)
    return {
      value,
      fact: `status:${target.id}`,
      expect: { type: 'status', target_id: target.id, kinds: fresh.map((e) => e.kind_id).filter((k) => k != null) },
    }
  }
  return null
}

/**
 * The cells a trap actually pays on: the enemy's own approach. Walking the shortest 4-dir route from the
 * nearest enemy to the caster and trapping a cell on it is the difference between a placed trap and a
 * SPRUNG one — and only a sprung trap proves anything.
 */
const approach_cells = (read, caster_cell, enemy) => {
  const out = []
  let cursor = { ...enemy.cell_committed }
  for (let step = 0; step < 8 && (cursor.x !== caster_cell.x || cursor.y !== caster_cell.y); step++) {
    const dx = caster_cell.x - cursor.x
    const dy = caster_cell.y - cursor.y
    cursor =
      Math.abs(dx) >= Math.abs(dy)
        ? { x: cursor.x + Math.sign(dx), y: cursor.y }
        : { x: cursor.x, y: cursor.y + Math.sign(dy) }
    if (cursor.x === caster_cell.x && cursor.y === caster_cell.y) break
    out.push({ ...cursor })
  }
  return out
}

/** Score a free-cell spell (trap / glyph) on one board cell. */
const score_on_cell = (spell, cell) => {
  const trap = spell.effects.find((e) => e.kind === 'PLACE_TRAP' || e.kind === 'PLACE_GLYPH')
  if (!trap) return null
  return {
    value: Math.max(1, Number(trap.base ?? 0)) * WEIGHTS.trap,
    fact: `trap:${cell_index(cell)}`,
    expect: { type: 'trap', cell },
  }
}

/**
 * Is this spell available THIS turn? The read is a snapshot — it carries the book's authored cooldown but not
 * how long ago each card was played, which is knowledge the player has on screen and the bot must carry
 * itself. `history.casts[spell_id]` is the turn it was last cast; `blocked` holds ids the authority has
 * already refused this fight (a bot that re-proposes a refused cast every turn stalls forever).
 *
 * THE COOLDOWN VERDICT IS IMPORTED, never arithmetic of its own (#1157). `on_cooldown` is the extracted home the
 * board's castable gate and the hotbar's grey socket already read, and it is `cast.move:380`'s rule verbatim:
 * recastable only when `current − last > cooldown`. The copy that used to live here said `>=`, so at
 * `turn − last === cooldown` the bot believed a spell castable that all three authorities refuse — and one
 * refusal used to retire the spell for the whole run.
 */
const available = (spell, read, { casts = {}, blocked = [] } = {}) => {
  if (blocked.includes(spell.id)) return false
  return !on_cooldown(casts[spell.id], Number(read.turn_number ?? 0), Number(spell.cooldown ?? 0))
}

/** How many of `spell_key` this turn's draft already holds — the per-turn axis of the authored caps. */
const casts_of = (cast_path, spell_key) => cast_path.filter((row) => row.spell_key === spell_key).length

/** Every legal, affordable, still-unclaimed candidate cast from `from`, best first. */
const candidates = (read, me, from, ap, claimed, seed, history) => {
  const enemies = enemies_of(read)
  const rows = []
  for (const spell of read.spellbook) {
    if (spell.ap > ap) continue
    if (!available(spell, read, history)) continue
    // THE AUTHORED CAPS, READ (#1157). `casts_per_turn` / `casts_per_target` ride the seam's book already;
    // `cap_of` is the decoder for the spell_bands UNLIMITED sentinels and `target_cap_reached` is cast.move's
    // own per-(spell, cell) verdict. The hardcoded "one cast per spell per turn" that stood here was a content
    // fact frozen into the instrument: a `casts_per_turn: 2` row left half a turn's damage unexercised, silently.
    if (casts_of(claimed.cast_path, spell.name_key) >= cap_of(spell.casts_per_turn)) continue
    if (spell.free_cell) {
      const [near] = enemies
        .slice()
        .sort((a, b) => manhattan(a.cell_committed, from) - manhattan(b.cell_committed, from))
      if (!near) continue
      for (const cell of approach_cells(read, from, near)) {
        const scored = score_on_cell(spell, cell)
        if (!scored || claimed.facts.has(scored.fact)) continue
        if (
          !spell_reaches(read, spell, from, cell, me.id, {
            target_cap_reached: (target) =>
              target_cap_reached(claimed.cast_path, spell.name_key, cell_index(target), spell.casts_per_target),
          })
        )
          continue
        rows.push({ ...scored, spell, cell })
      }
      continue
    }
    for (const target of living(read)) {
      // A SELF-CAST FOLLOWS THE CASTER. `from` may be a planned reposition, and the read still holds my
      // pre-move cell — measuring a range-[0,0] self buff against that stale cell made every buff illegal
      // the moment the bot decided to walk.
      const target_cell = target.id === me.id ? from : target.cell_committed
      const scored = score_on_fighter(spell, { ...me, cell_committed: from }, target)
      if (!scored || scored.value < WEIGHTS.floor || claimed.facts.has(scored.fact)) continue
      if (
        !spell_reaches(read, spell, from, target_cell, me.id, {
          target_cap_reached: (target) =>
            target_cap_reached(claimed.cast_path, spell.name_key, cell_index(target), spell.casts_per_target),
        })
      )
        continue
      rows.push({ ...scored, spell, cell: target_cell })
    }
  }
  return rows.sort(
    (a, b) =>
      b.value - a.value ||
      a.spell.ap - b.spell.ap ||
      tie_break(seed, `${a.spell.id}:${a.fact}`) - tie_break(seed, `${b.spell.id}:${b.fact}`)
  )
}

/**
 * The reposition's two objective functions. `total` is what standing there is worth; `enemy` is what it is
 * worth AGAINST SOMETHING — and only the second may decide to close the distance. A self-buff is castable
 * from any cell on the board, so ranking on the total alone made the bot "already in range" forever: it
 * stood on its start cell buffing itself while the mob it never approached waited across the map.
 */
const best_from = (read, me, cell, ap, seed, history) => {
  const rows = candidates(read, me, cell, ap, { facts: new Set(), cast_path: [] }, seed, history)
  const enemy_ids = new Set(enemies_of(read).map((e) => e.id))
  return {
    total: rows[0]?.value ?? 0,
    enemy: rows.find((r) => enemy_ids.has(r.expect.target_id) || r.expect.type === 'trap')?.value ?? 0,
  }
}

/**
 * PHASE 1 — where to stand. Returns `{ cell, cost, why }` (cost 0 = stay put).
 * Two rules a player would recognise: never disengage from an adjacent body (that is a free tackle), and
 * when nothing is castable from anywhere, close the distance instead of standing still.
 */
const choose_stance = (read, me, seed, history) => {
  const here = me.cell_committed
  const enemies = enemies_of(read)
  const mp = Number(me.mp ?? me.mp_committed ?? 0)
  const ap = Number(me.ap ?? me.ap_committed ?? 0)
  const stay = { cell: here, cost: 0, why: 'stayed put', decisions: [] }
  if (!enemies.length || mp <= 0) return stay
  // tackle adjacency is ORTHOGONAL (fight_tackle.js scans 4 cells) — a diagonal enemy cannot tackle
  if (enemies.some((e) => manhattan(e.cell_committed, here) <= 1))
    return {
      ...stay,
      decisions: [{ phase: 'move', chose: 'stay', why: 'an enemy is adjacent — disengaging invites a tackle' }],
    }
  const base = best_from(read, me, here, ap, seed, history)
  const nearest = (cell) => Math.min(...enemies.map((e) => manhattan(e.cell_committed, cell)))
  const options = reachable_cells(read, here, mp, me.id)
    .map((cell) => ({
      cell,
      cost: path_cost(read, here, cell, mp, me.id),
      ...best_from(read, me, cell, ap, seed, history),
    }))
    .filter((o) => o.cost != null)
  // Rank: offensive value first, then total value, then closer to the fight, then cheaper, then the seed.
  const ranked = options.sort(
    (a, b) =>
      b.enemy - a.enemy ||
      b.total - a.total ||
      nearest(a.cell) - nearest(b.cell) ||
      a.cost - b.cost ||
      tie_break(seed, `${cell_index(a.cell)}`) - tie_break(seed, `${cell_index(b.cell)}`)
  )
  const [best] = ranked
  // KEEP RANGE. Two reasons to leave: a better shot opens up somewhere else, or NOTHING can be aimed at an
  // enemy from anywhere reachable and the gap has to be closed. A caster that can already shoot holds still.
  const unlocks = !!best && best.cost > 0 && best.enemy > base.enemy
  const approach = !!best && best.cost > 0 && base.enemy === 0 && best.enemy === 0 && nearest(best.cell) < nearest(here)
  const target = approach
    ? ranked.filter((o) => o.cost > 0).sort((a, b) => nearest(a.cell) - nearest(b.cell) || a.cost - b.cost)[0]
    : best
  const decision = {
    phase: 'move',
    considered: ranked.slice(0, 4).map((o) => ({
      cell: o.cell,
      cost: o.cost,
      cast_value: o.total,
      enemy_value: o.enemy,
      nearest_enemy: nearest(o.cell),
    })),
    chose: unlocks || approach ? target.cell : 'stay',
    why: unlocks
      ? `moving unlocks ${best.enemy} points of offensive value (vs ${base.enemy} from here)`
      : approach
        ? `no enemy is reachable by any spell — closing from ${nearest(here)} to ${nearest(target.cell)}`
        : base.enemy > 0
          ? `already in range for ${base.enemy} points of offensive value — holding position`
          : 'no reachable cell improves on standing here',
  }
  return unlocks || approach
    ? { cell: target.cell, cost: target.cost, why: 'reposition', decisions: [decision] }
    : { ...stay, decisions: [decision] }
}

/**
 * PLAN ONE TURN. Pure.
 * @param {object} read a `__ARES_DEV_READ()` snapshot
 * @param {{ seed?: number, history?: { casts?: Record<string, number>, blocked?: string[] } }} [options]
 *   `seed` breaks exact-value ties (same seed ⇒ same turn); `history` is what the snapshot cannot carry —
 *   `casts` (the cooldown ledger) and `blocked` (spells the authority already refused this fight).
 * @returns {{ actions: Array<object>, decisions: Array<object>, reason: string }}
 */
export const plan_turn = (read, { seed = 0, history = {} } = {}) => {
  const me = me_of(read)
  if (!me) return { actions: [], decisions: [], reason: 'no seat in this fight' }
  if (read.active_id !== read.my_id) return { actions: [], decisions: [], reason: 'not my turn' }
  if (!enemies_of(read).length) return { actions: [], decisions: [], reason: 'no living enemy — nothing to do' }

  const stance = choose_stance(read, me, seed, history)
  // The decision list is BUILT, never pushed into a caller's array: `plan_turn` owns it and hands it back
  // beside the actions, so a reader can see the whole turn's reasoning next to the turn it produced.
  const decisions = [...stance.decisions]
  const actions = []
  if (stance.cost > 0)
    actions.push({
      kind: 0,
      cell: stance.cell,
      expect: { type: 'move', cell: stance.cell, mp_cost: stance.cost },
    })

  // `cast_path` is the turn's draft in `draft_budget`'s own shape ({ cell, spell_key }), so the per-turn and
  // per-target caps are the board's verdicts and not a second accounting; `facts` stays the harness rule that
  // one action owns one assertable fact.
  const claimed = { facts: new Set(), cast_path: [] }
  // The PRESENTED budget, not the committed one: `ap`/`mp` carry the fold's predicted begin-turn refill, so
  // they are what the player's own bar shows for the turn about to be played.
  let ap = Number(me.ap ?? me.ap_committed ?? 0)
  for (let step = 0; step < 8; step++) {
    const rows = candidates(read, me, stance.cell, ap, claimed, seed, history)
    const [pick] = rows
    decisions.push({
      phase: 'cast',
      step,
      ap_left: ap,
      considered: rows
        .slice(0, 4)
        .map((r) => ({ spell: r.spell.name_key, ap: r.spell.ap, at: r.cell, value: r.value, fact: r.fact })),
      chose: pick ? `${pick.spell.name_key} → ${pick.cell.x},${pick.cell.y}` : 'end turn',
      why: pick
        ? `highest value legal cast (${pick.value}) for ${pick.spell.ap} AP`
        : ap <= 0
          ? 'out of AP'
          : 'no legal cast left is worth an AP',
    })
    if (!pick) break
    claimed.facts.add(pick.fact)
    claimed.cast_path.push({ cell: cell_index(pick.cell), spell_key: pick.spell.name_key })
    ap -= pick.spell.ap
    actions.push({
      kind: 1,
      cell: pick.cell,
      spell_id: pick.spell.id,
      spell_key: pick.spell.name_key,
      ap_cost: pick.spell.ap,
      // the caster's cell AT CAST TIME — a push's direction is measured from here, not from where the turn began
      from: stance.cell,
      expect: { ...pick.expect, from: stance.cell },
    })
  }
  return { actions, decisions, reason: actions.length ? 'planned' : 'pass' }
}

export { get_direction }
