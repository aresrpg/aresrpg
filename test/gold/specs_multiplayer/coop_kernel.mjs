// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP KERNEL — the pure decision legs shared by the multiplayer coop gold rows.
// Plain data in → plain data out, zero IO, zero mutation (house FP constitution): the spec is the effect shell,
// these are the transforms it routes through. The xp twin mirrors packages/move/engine/sources/settlement.move
// `xp_share_kernel` BYTE-FOR-BYTE in u64 semantics (BigInt floor division, same operation order) so the per-seat
// split assert is an exact chain-truth equation, never an adjective.

const as_u64 = (value, label) => {
  const n = BigInt(value ?? 0)
  if (n < 0n) throw new Error(`coop_kernel: ${label} must be >= 0`)
  return n
}

/**
 * Which actor may act RIGHT NOW: the one whose seat entity is the active id, and only when no wave is
 * presenting (the presentation gate disarms input — clicking through it is the bug class the anchor suite
 * kills). Mob turns and empty actives route to nobody.
 * @param {{ active: string|null, presenting: boolean }} phase
 * @param {Array<{ actor: string, entity: string }>} seats
 * @returns {string|null}
 */
export function actor_for_turn({ active, presenting }, seats) {
  if (presenting || !active) return null
  return seats.find((seat) => seat.entity === active)?.actor ?? null
}

/**
 * Fold one observer page's rendered probe beats into the cross-visibility ledger: an entry records that
 * `observer` SAW `caster` cast on its own rendered layer. Own casts never count (self-visibility is not the
 * claim); rows dedupe; the input ledger is never mutated.
 * @param {Record<string, string[]>} ledger observer → casters seen (sorted append order)
 * @param {string} observer
 * @param {Array<{ kind: string, id: string|null }>} beats the observer page's __ARES_FIGHT_PROBE.beats
 * @param {Record<string, string>} entity_by_actor actor → fight entity id
 * @returns {Record<string, string[]>} a NEW ledger
 */
export function visibility_fold(ledger, observer, beats, entity_by_actor) {
  const actor_by_entity = Object.fromEntries(Object.entries(entity_by_actor).map(([actor, entity]) => [entity, actor]))
  const seen = new Set(ledger[observer] ?? [])
  for (const beat of beats) {
    if (beat.kind !== 'cast' || beat.id == null) continue
    const caster = actor_by_entity[beat.id]
    if (caster && caster !== observer) seen.add(caster)
  }
  return { ...ledger, [observer]: [...seen] }
}

/**
 * Verdict over the required observer→caster pairs. Missing pairs come back named ('B→A' = B never saw A cast).
 * @param {Record<string, string[]>} ledger
 * @param {Array<[string, string]>} required_pairs [observer, caster][]
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function visibility_complete(ledger, required_pairs) {
  const missing = required_pairs
    .filter(([observer, caster]) => !(ledger[observer] ?? []).includes(caster))
    .map(([observer, caster]) => `${observer}→${caster}`)
  return { ok: missing.length === 0, missing }
}

const normalized_kind = (kind) =>
  String(kind ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

// This is strategy vocabulary, never the source of the checklist. Requirements are derived from every effect
// kind the boot-published runtime catalog carries. A new catalog kind therefore becomes an unclassified failure
// instead of disappearing through a permissive `continue`.
const oracle_by_kind = {
  DAMAGE: 'damage',
  LIFE_STEAL: 'life_steal',
  CASTER_DAMAGE: 'caster_damage',
  HEAL: 'heal',
  GIVE_POINTS: 'resource_grant',
  REMOVE_POINTS: 'resource_drain',
  ALTER_STAT: 'stat_delta',
  PUSH: 'push',
  TELEPORT: 'teleport',
  PLACE_TRAP: 'trap',
  APPLY_DOT: 'dot',
  INVISIBILITY: 'invisibility',
}

const unassertable_reason_by_kind = {
  // HONESTY: paired debit/credit kind-9 rows survive, but neither fighter's live Stats block does. Their actual
  // symmetric effective-stat changes therefore cannot be compared across the five committed-board exports.
  STEAL_STAT: 'paired kind-9 rows are visible, but neither fighter’s live Stats block is exported',
  // HONESTY: kind-11 rows survive the status fold, while the live resistance block is discarded before that fold.
  ALTER_RESIST: 'the kind-11 row is visible, but the live resistance block is absent from committed exports',
  // HONESTY: Ram Aspect is the only L100-kit PULL. Its rank-1 row is free-cell + point-area, so every legal
  // endpoint is empty and no fighter can receive kind 13; no committed fighter position delta can exist.
  PULL: 'Ram Aspect is free-cell with a point-area PULL, so every legal endpoint contains no fighter',
  // HONESTY: the five fighter-board exports omit Fight.fx.cell_entries, and glyph placement changes no fighter
  // field at cast time. A later payload delta cannot uniquely distinguish a glyph from concurrent DoT/direct
  // damage, so kind 20 placement is not falsely inferred from a fighter-only board.
  PLACE_GLYPH: 'the five fighter-board exports omit Fight.fx glyph cells, so placement is not observable',
  // HONESTY: kind 24 lands a status row, but the current engine ordinary-hit path never consumes it. Claiming
  // absorption from an unchanged HP sample would therefore be a false positive, not effect application.
  REDUCE_DAMAGE: 'the current ordinary-hit resolver does not apply kind-24 absorption to committed HP',
  // HONESTY: Prowler's Eye reveals enemies, while this PvM fixture has no invisible mob. Player invisibility is
  // same-team and therefore ineligible; its committed cast is necessarily a no-op for kind 28 in this topology.
  REVEAL: 'the PvM fixture has no eligible invisible enemy for Prowler’s Eye to reveal',
  // HONESTY: Mirror Covenant can arm kind 29, but the fixture mob casts ALLMAP. Return resolution requires an
  // eligible point-shaped enemy cast; observing the arming status alone would not prove a spell was returned.
  RETURN_SPELL: 'the fixture has no eligible point-shaped enemy cast to prove an actual return',
}

const unassertable_reason_for = (kind, stat) => {
  // HONESTY: committed rows retain every kind-9 status but expose an effective stat only for range, whose
  // production fold consumes immutable base_range + active stat-6 rows. Other stat dimensions have no committed
  // effective value here, so their status presence alone is not misreported as the requested stat delta.
  if (kind === 'ALTER_STAT' && Number(stat) !== 6)
    return 'only range has a committed effective-stat projection; the other live Stats dimensions are omitted'
  return unassertable_reason_by_kind[kind] ?? null
}

/** @param {unknown} kind @returns {string|null} */
export function effect_oracle_for_kind(kind) {
  return oracle_by_kind[normalized_kind(kind)] ?? null
}

const resource_key = (kind, stat) => {
  if (kind === 'GIVE_POINTS') {
    if (Number(stat) === 0) return `${kind}:AP`
    if (Number(stat) === 1) return `${kind}:MP`
    return `${kind}:${String(stat ?? 'unknown')}`
  }
  if (kind === 'ALTER_STAT') return Number(stat) === 6 ? `${kind}:RANGE` : `${kind}:UNEXPORTED`
  return kind
}

/**
 * Enumerate every learned-rank effect kind per class through `max_unlock_level`. GIVE_POINTS is split by its
 * AP/MP discriminator because proving one budget must never green the other. Resolution reads levels[0], so the
 * oracle does too. Unknown kinds remain rows with `oracle:null` and fail `effect_catalog_verdict`.
 * @param {Array<{ class?: string, unlock_level?: number, name_key?: string,
 *   levels?: Array<{ effects?: Array<{ kind?: unknown, kind_id?: unknown, stat?: unknown }> }> }>} spells
 * @param {string[]} class_ids
 * @param {number} max_unlock_level
 * @returns {Record<string, Array<{ key:string, kind:string, kind_id:number|null, stat:number|null,
 *   oracle:string|null, spell_ids:string[], unassertable_reason:string|null }>>}
 */
export function effect_requirements_by_class(spells, class_ids, max_unlock_level = 100) {
  const classes = [...new Set(class_ids.map((class_id) => String(class_id).toLowerCase()))]
  const out = Object.fromEntries(classes.map((class_id) => [class_id, []]))
  const candidates = [...spells]
    .filter(
      (spell) =>
        classes.includes(String(spell?.class ?? '').toLowerCase()) &&
        Number(spell?.unlock_level ?? Infinity) <= max_unlock_level &&
        typeof spell?.name_key === 'string' &&
        spell.name_key.length > 0
    )
    .sort(
      (left, right) =>
        Number(left.unlock_level) - Number(right.unlock_level) || left.name_key.localeCompare(right.name_key)
    )

  for (const spell of candidates) {
    const class_id = String(spell.class).toLowerCase()
    for (const effect of spell.levels?.[0]?.effects ?? []) {
      const kind = normalized_kind(effect.kind)
      const stat = effect.stat == null ? null : Number(effect.stat)
      const key = resource_key(kind, stat)
      let requirement = out[class_id].find((row) => row.key === key)
      if (!requirement) {
        const parsed_kind_id = Number(effect.kind_id)
        requirement = {
          key,
          kind,
          kind_id: Number.isFinite(parsed_kind_id) ? parsed_kind_id : null,
          stat,
          oracle: effect_oracle_for_kind(kind),
          spell_ids: [],
          unassertable_reason: unassertable_reason_for(kind, stat),
        }
        out[class_id].push(requirement)
      }
      if (!requirement.spell_ids.includes(spell.name_key)) requirement.spell_ids.push(spell.name_key)
    }
  }
  for (const class_id of classes) out[class_id].sort((left, right) => left.key.localeCompare(right.key))
  return out
}

/** Diff the catalog-derived inventory against the assertion/explicit-honesty strategy vocabulary. */
export function effect_catalog_verdict(requirements) {
  const rows = Object.entries(requirements).flatMap(([class_id, class_rows]) =>
    class_rows.map((row) => ({ class_id, ...row }))
  )
  const uncovered = rows
    .filter((row) => !row.oracle && !row.unassertable_reason)
    .map((row) => `${row.class_id}/${row.key}`)
  const unassertable = rows
    .filter((row) => row.unassertable_reason)
    .map((row) => `${row.class_id}/${row.key}: ${row.unassertable_reason}`)
  const kinds = [...new Set(rows.map((row) => row.kind))].sort()
  const asserted_kinds = kinds.filter((kind) =>
    rows.some((row) => row.kind === kind && row.oracle && !row.unassertable_reason)
  )
  const unassertable_kinds = kinds.filter(
    (kind) => !asserted_kinds.includes(kind) && rows.some((row) => row.kind === kind && row.unassertable_reason)
  )
  return {
    ok: uncovered.length === 0,
    kinds,
    asserted_kinds,
    unassertable_kinds,
    uncovered,
    unassertable,
  }
}

const fighter_in = (board, id) =>
  Array.isArray(board) ? (board.find((fighter) => String(fighter?.id) === String(id)) ?? null) : null

const same_cell = (left, right) => {
  if (left == null || right == null) return false
  if (typeof left === 'object' && typeof right === 'object')
    return Number(left.x) === Number(right.x) && Number(left.y) === Number(right.y)
  return String(left) === String(right)
}

const crossed_cell = (from, to, cell) => {
  if (!from || !to || !cell) return false
  const same_column = Number(from.x) === Number(to.x) && Number(cell.x) === Number(from.x)
  const same_row = Number(from.y) === Number(to.y) && Number(cell.y) === Number(from.y)
  if (!same_column && !same_row) return false
  const between = (value, left, right) => value >= Math.min(left, right) && value <= Math.max(left, right)
  return between(Number(cell.x), Number(from.x), Number(to.x)) && between(Number(cell.y), Number(from.y), Number(to.y))
}

const effect_signature = (effect) =>
  JSON.stringify([
    effect?.kind ?? null,
    effect?.stat ?? null,
    effect?.value ?? null,
    effect?.element ?? null,
    effect?.flags ?? null,
  ])

const gained_effects = (before, after, predicate = () => true) => {
  const counts = new Map()
  const gained = []
  for (const effect of before?.effects ?? []) {
    const signature = effect_signature(effect)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  for (const effect of after?.effects ?? []) {
    const signature = effect_signature(effect)
    const remaining = counts.get(signature) ?? 0
    if (remaining > 0) counts.set(signature, remaining - 1)
    else if (predicate(effect)) gained.push(effect)
  }
  return gained
}

const gained_effect = (before, after, predicate = () => true) => gained_effects(before, after, predicate).length > 0

const exact_status = (before, after, kind_id, stat = null) =>
  kind_id != null &&
  Number.isFinite(Number(kind_id)) &&
  gained_effect(
    before,
    after,
    (effect) => Number(effect?.kind) === Number(kind_id) && (stat == null || Number(effect?.stat) === Number(stat))
  )

const resource_of = (fighter, resource) => (fighter?.[resource] == null ? Number.NaN : Number(fighter[resource]))

const five_exports = (exports) => Array.isArray(exports) && exports.length === 5

const same_exports = (exports) =>
  five_exports(exports) && exports.every((board) => JSON.stringify(board) === JSON.stringify(exports[0]))

const turn_unchanged = (before_board, after_board, fighter_id) => {
  const before = fighter_in(before_board, fighter_id)
  const after = fighter_in(after_board, fighter_id)
  return (
    before?.turn_number != null &&
    after?.turn_number != null &&
    Number(before.turn_number) === Number(after.turn_number)
  )
}

const no_other_hp_loss = (before_board, after_board, fighter_id) =>
  before_board.every((before) => {
    if (String(before?.id) === String(fighter_id)) return true
    const after = fighter_in(after_board, before?.id)
    return after && Number(after.hp) >= Number(before.hp)
  })

/** Prove one raw catalog kind from committed exports (plus the trap renderer beat); siblings cannot satisfy it. */
export function effect_evidence_observed(observation) {
  const before = fighter_in(observation.before, observation.target_id)
  const after = fighter_in(observation.after, observation.target_id)
  if (!before || !after) return false
  const hp_loss = Number(before.hp) - Number(after.hp)

  if (observation.kind === 'DAMAGE')
    return (
      Number.isFinite(hp_loss) &&
      hp_loss > 0 &&
      turn_unchanged(observation.before, observation.after, observation.target_id)
    )
  if (observation.kind === 'LIFE_STEAL') {
    const caster_before = fighter_in(observation.before, observation.caster_id)
    const caster_after = fighter_in(observation.after, observation.caster_id)
    return (
      hp_loss > 0 &&
      turn_unchanged(observation.before, observation.after, observation.target_id) &&
      caster_before &&
      caster_after &&
      Number(caster_after.hp) > Number(caster_before.hp)
    )
  }
  if (observation.kind === 'CASTER_DAMAGE')
    return (
      String(observation.target_id) === String(observation.caster_id) &&
      hp_loss > 0 &&
      turn_unchanged(observation.before, observation.after, observation.target_id) &&
      no_other_hp_loss(observation.before, observation.after, observation.target_id)
    )
  if (observation.kind === 'HEAL') return hp_loss < 0
  if (observation.kind === 'GIVE_POINTS') {
    const resource = String(observation.resource)
    const grant = Number(observation.grant)
    const minimum_grant = Number(observation.minimum_grant)
    const spent = Number(observation.spent)
    const remaining = Number(observation.remaining)
    const before_pool = resource_of(before, resource)
    const { turn_exports } = observation
    const proof = turn_exports?.[0]
    const observed_fighters = five_exports(observation.observer_exports)
      ? observation.observer_exports.map((board) => fighter_in(board, observation.target_id))
      : []
    return (
      ['ap', 'mp'].includes(resource) &&
      Number.isFinite(before_pool) &&
      minimum_grant > 0 &&
      grant === minimum_grant &&
      spent > before_pool &&
      spent <= before_pool + minimum_grant &&
      remaining === before_pool + grant - spent &&
      remaining >= 0 &&
      same_exports(observation.before_exports) &&
      JSON.stringify(observation.before_exports[0]) === JSON.stringify(observation.before) &&
      observed_fighters.length === 5 &&
      observed_fighters.every(Boolean) &&
      observed_fighters.every((fighter) => same_cell(fighter.cell, observed_fighters[0].cell)) &&
      same_cell(after.cell, observed_fighters[0].cell) &&
      same_exports(turn_exports) &&
      proof?.entity === observation.target_id &&
      proof?.resource === resource &&
      Number(proof?.start) === before_pool &&
      Number(proof?.minimum_grant) === minimum_grant &&
      Number(proof?.spent) === spent &&
      Number(proof?.minimum_remaining) === remaining &&
      Number(proof?.action_count) === Number(observation.committed_casts) &&
      same_cell(proof?.grant_target, observation.grant_target) &&
      (resource !== 'mp' || observed_fighters.every((fighter) => same_cell(proof?.destination, fighter.cell)))
    )
  }
  if (observation.kind === 'REMOVE_POINTS') {
    if (String(observation.target_id) === String(observation.caster_id)) return false
    const resource = observation.resource == null ? null : String(observation.resource)
    const removed = resource_of(before, resource) - resource_of(after, resource)
    const { drain_exports } = observation
    const proof = drain_exports?.[0]
    return (
      ['ap', 'mp'].includes(resource) &&
      removed > 0 &&
      same_exports(drain_exports) &&
      proof?.caster === observation.caster_id &&
      proof?.target === observation.target_id &&
      proof?.resource === resource &&
      Number(proof?.removed) === removed &&
      Number(proof?.requested) >= removed &&
      Number(proof?.cast_count) === 1 &&
      same_cell(proof?.cast_target, observation.cast_target)
    )
  }
  if (observation.kind === 'ALTER_STAT')
    return (
      Number(observation.stat) === 6 &&
      Number.isFinite(Number(before.effective_range)) &&
      Number.isFinite(Number(after.effective_range)) &&
      Number(after.effective_range) !== Number(before.effective_range) &&
      exact_status(before, after, observation.kind_id, observation.stat)
    )
  if (observation.kind === 'PUSH')
    return (
      !same_cell(before.cell, after.cell) &&
      turn_unchanged(observation.before, observation.after, observation.target_id)
    )
  if (observation.kind === 'TELEPORT')
    return (
      !same_cell(before.cell, after.cell) &&
      same_cell(after.cell, observation.cast_target) &&
      turn_unchanged(observation.before, observation.after, observation.target_id)
    )
  if (observation.kind === 'PLACE_TRAP')
    return (
      crossed_cell(before.cell, after.cell, observation.trap_cell) &&
      observation.trigger_beat?.kind === 'trap_trigger' &&
      String(observation.trigger_beat?.id) === String(observation.target_id) &&
      observation.trigger_after_t != null &&
      Number.isFinite(Number(observation.trigger_after_t)) &&
      Number.isFinite(Number(observation.trigger_beat?.t)) &&
      Number(observation.trigger_beat?.t) > Number(observation.trigger_after_t)
    )
  if (observation.kind === 'APPLY_DOT') {
    const { dot_exports } = observation
    const proof = dot_exports?.[0]
    const observed_targets = five_exports(observation.observer_exports)
      ? observation.observer_exports.map((board) => fighter_in(board, observation.target_id))
      : []
    return (
      hp_loss > 0 &&
      observed_targets.length === 5 &&
      observed_targets.every((fighter) => Number(fighter?.hp) === Number(proof?.remaining_hp)) &&
      Number(after.hp) === Number(proof?.remaining_hp) &&
      same_exports(dot_exports) &&
      proof?.caster === observation.caster_id &&
      proof?.target === observation.target_id &&
      Number(proof?.cast_count) === 1 &&
      same_cell(proof?.cast_target, before.cell) &&
      Number(proof?.amount) === hp_loss &&
      Number(proof?.remaining_hp) === Number(after.hp)
    )
  }
  if (observation.kind === 'INVISIBILITY') {
    const { before_exports, observer_exports: after_exports } = observation
    return (
      same_exports(before_exports) &&
      before_exports.every(
        (row) =>
          row?.target === observation.target_id &&
          row?.status_kind == null &&
          row?.invisible === false &&
          Number(row?.remaining_turns) === 0
      ) &&
      same_exports(after_exports) &&
      after_exports.every(
        (row) =>
          row?.target === observation.target_id &&
          Number(row?.status_kind) === Number(observation.kind_id) &&
          row?.invisible === true &&
          Number(row?.remaining_turns) > 0
      )
    )
  }
  return false
}

/**
 * Credit a candidate only when its raw-kind proof passes. Ledger shape is class → requirement key → spell ids;
 * the returned value and every nested row are fresh, so failed/duplicate observations cannot mutate history.
 * @param {Record<string, Record<string, string[]>>} ledger
 * @param {{ class_id: string, kind: string, requirement_key?: string, spell_id: string, target_id: string,
 *   caster_id?: string, kind_id?: number|null, stat?: number|null, resource?: string|null, before: unknown,
 *   after: unknown, cast_target?: unknown, trap_cell?: unknown, trigger_after_t?: number|null,
 *   trigger_beat?: { t?: number, kind?: string, id?: string|null }|null, payload_applied?: boolean,
 *   grant?: number, minimum_grant?: number, spent?: number, remaining?: number, committed_casts?: number,
 *   grant_target?: unknown, before_exports?: unknown, observer_exports?: unknown, turn_exports?: unknown,
 *   drain_exports?: unknown, dot_exports?: unknown }} observation
 * @returns {Record<string, Record<string, string[]>>}
 */
export function effect_evidence_fold(ledger, observation) {
  if (!effect_evidence_observed(observation)) return ledger
  const class_id = String(observation.class_id).toLowerCase()
  const class_ledger = ledger[class_id] ?? {}
  const kind = normalized_kind(observation.kind)
  const key = resource_key(kind, observation.stat)
  if (observation.requirement_key != null && String(observation.requirement_key) !== key) return ledger
  const credited = new Set(class_ledger[key] ?? [])
  credited.add(observation.spell_id)
  return {
    ...ledger,
    [class_id]: { ...class_ledger, [key]: [...credited] },
  }
}

/** Name every distinct catalog-derived kind still lacking one proof. AP and MP grants remain separate keys. */
export function effect_evidence_verdict(requirements, ledger) {
  const rows = Object.entries(requirements).flatMap(([class_id, class_rows]) =>
    class_rows.map((row) => ({ class_id, ...row }))
  )
  const observable_keys = [
    ...new Set(rows.filter((row) => row.oracle && !row.unassertable_reason).map((row) => row.key)),
  ].sort()
  const missing = observable_keys.flatMap((key) => {
    const candidates = rows.filter((row) => row.key === key && row.oracle && !row.unassertable_reason)
    const observed = candidates.some((row) =>
      row.spell_ids.some((spell_id) => (ledger[row.class_id]?.[row.key] ?? []).includes(spell_id))
    )
    return observed
      ? []
      : [`${key}:[${candidates.flatMap((row) => row.spell_ids.map((spell) => `${row.class_id}/${spell}`)).join('|')}]`]
  })
  return { ok: missing.length === 0, missing }
}

/**
 * EXACT twin of settlement.move `xp_share_kernel` (u64 floor division at every step, Move's operation order):
 *   total / party × (600 + wisdom) / 600 × (10000 + aged_bp) / 10000 × mult / 100
 * @param {{ total_xp: number|string|bigint, party_size: number|string|bigint, wisdom: number|string|bigint,
 *           aged_bp: number|string|bigint, xp_mult: number|string|bigint }} args
 * @returns {bigint}
 */
export function xp_share_kernel({ total_xp, party_size, wisdom, aged_bp, xp_mult }) {
  const party = as_u64(party_size, 'party_size')
  if (party === 0n) return 0n
  const BP_ONE = 10_000n
  return (
    ((((((as_u64(total_xp, 'total_xp') / party) * (600n + as_u64(wisdom, 'wisdom'))) / 600n) *
      (BP_ONE + as_u64(aged_bp, 'aged_bp'))) /
      BP_ONE) *
      as_u64(xp_mult, 'xp_mult')) /
    100n
  )
}

/**
 * Per-seat settlement verdict for a WON coop PvM fight: every seat's outcome is VICTORY (2), every seat's
 * xp_share equals ITS OWN kernel share (wisdom is the only legal divergence between seats), and every seat got
 * the same loot-checklist treatment (the checklist is copied whole per winning seat, never split).
 * @param {Array<{ character: string, outcome: number, xp_share: number|string|bigint, loot_len: number }>} outcomes
 * @param {{ total_xp: number|string|bigint, aged_bp: number|string|bigint, xp_mult: number|string|bigint,
 *           wisdom_by_character: Record<string, number|string|bigint> }} fight
 * @returns {{ ok: boolean, reason: string|null, expected: Record<string, bigint> }}
 */
export function split_verdict(outcomes, { total_xp, aged_bp, xp_mult, wisdom_by_character }) {
  const expected = Object.fromEntries(
    outcomes.map(({ character }) => [
      character,
      xp_share_kernel({
        total_xp,
        party_size: outcomes.length,
        wisdom: wisdom_by_character[character] ?? 0,
        aged_bp,
        xp_mult,
      }),
    ])
  )
  const fail = (reason) => ({ ok: false, reason, expected })
  for (const seat of outcomes) {
    if (seat.outcome !== 2) return fail(`seat ${seat.character} outcome ${seat.outcome} is not VICTORY (2)`)
    if (BigInt(seat.xp_share ?? 0) !== expected[seat.character])
      return fail(`seat ${seat.character} paid xp_share ${seat.xp_share}, kernel expects ${expected[seat.character]}`)
  }
  const loot_lens = new Set(outcomes.map((seat) => seat.loot_len))
  if (loot_lens.size > 1)
    return fail(`unequal loot checklists across seats: [${outcomes.map((s) => s.loot_len).join(', ')}]`)
  return { ok: true, reason: null, expected }
}

/**
 * The disconnect-crank wait bound: a deserted seat forfeits at its turn deadline (turn_ms), the crank resolves
 * it plus the mob wave behind it — two turn windows plus presentation slack covers the worst honest case; a
 * fight still stalled past this is WEDGED (the product bug this row exists to catch).
 * @param {number} turn_ms @param {number} slack_ms @returns {number}
 */
export function stall_budget_ms(turn_ms, slack_ms = 30_000) {
  return 2 * turn_ms + slack_ms
}
