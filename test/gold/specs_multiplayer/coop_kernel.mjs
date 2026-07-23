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

// The mapping is vocabulary, NOT a required-family checklist: requirements below are born only from kinds the
// boot-published runtime catalog actually carries for that class. Kinds with no export-observable proof stay out.
const observable_family_by_kind = {
  DAMAGE: 'damage',
  PERCENT_LIFE: 'damage',
  PERCENT_LIFE_DAMAGE: 'damage',
  LIFE_STEAL: 'damage',
  CASTER_DAMAGE: 'damage',
  PUNISHMENT: 'damage',
  PUNISHMENT_DAMAGE: 'damage',
  APPLY_DOT: 'damage',
  GIVE_POINTS: 'buff',
  ALTER_STAT: 'buff',
  STEAL_STAT: 'buff',
  ALTER_RESIST: 'buff',
  REDUCE_DAMAGE: 'shield',
  PUSH: 'displacement',
  PULL: 'displacement',
  TELEPORT: 'displacement',
  SWAP: 'displacement',
  SWAP_POSITIONS: 'displacement',
  CARRY: 'displacement',
  THROW: 'displacement',
  RESET_POSITIONS: 'displacement',
  GEOMETRIC_PUSH: 'displacement',
  PLACE_TRAP: 'trap',
}

const normalized_kind = (kind) =>
  String(kind ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

/**
 * Map one runtime-catalog effect kind to the committed-board family whose application has a concrete oracle.
 * Unknown/non-observable kinds return null and therefore cannot silently invent a requirement.
 * @param {unknown} kind
 * @returns {'damage'|'buff'|'shield'|'displacement'|'trap'|null}
 */
export function observable_effect_family(kind) {
  return observable_family_by_kind[normalized_kind(kind)] ?? null
}

/**
 * Derive the deterministic candidate spells for every observable family EACH requested class actually carries
 * through `max_unlock_level`. A family is satisfied by any one candidate: an effect may be present in a spell
 * whose target/range makes that leg inapplicable in the current fight. Resolution reads levels[0], so this does
 * too. No family list is injected: catalog kinds alone create the returned requirements.
 * @param {Array<{ class?: string, unlock_level?: number, name_key?: string,
 *   levels?: Array<{ effects?: Array<{ kind?: unknown }> }> }>} spells
 * @param {string[]} class_ids
 * @param {number} max_unlock_level
 * @returns {Record<string, Array<{ family: string, spell_ids: string[], effect_kinds: string[] }>>}
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
    const kinds = [...new Set((spell.levels?.[0]?.effects ?? []).map((effect) => normalized_kind(effect.kind)))]
    for (const effect_kind of kinds) {
      const family = observable_effect_family(effect_kind)
      if (!family) continue
      let requirement = out[class_id].find((row) => row.family === family)
      if (!requirement) {
        requirement = { family, spell_ids: [], effect_kinds: [] }
        out[class_id].push(requirement)
      }
      if (!requirement.spell_ids.includes(spell.name_key)) requirement.spell_ids.push(spell.name_key)
      if (!requirement.effect_kinds.includes(effect_kind)) requirement.effect_kinds.push(effect_kind)
    }
  }
  for (const class_id of classes) {
    out[class_id].sort((left, right) => left.family.localeCompare(right.family))
    for (const requirement of out[class_id]) requirement.effect_kinds.sort()
  }
  return out
}

const fighter_in = (board, id) =>
  Array.isArray(board) ? (board.find((fighter) => String(fighter?.id) === String(id)) ?? null) : null

const same_cell = (left, right) => {
  if (left == null || right == null) return false
  if (typeof left === 'object' && typeof right === 'object')
    return Number(left.x) === Number(right.x) && Number(left.y) === Number(right.y)
  return String(left) === String(right)
}

const effect_signature = (effect) =>
  JSON.stringify([effect?.kind ?? null, effect?.stat ?? null, effect?.value ?? null, effect?.element ?? null])

const gained_effect = (before, after, predicate = () => true) => {
  const counts = new Map()
  for (const effect of before?.effects ?? []) {
    const signature = effect_signature(effect)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  for (const effect of after?.effects ?? []) {
    const signature = effect_signature(effect)
    const remaining = counts.get(signature) ?? 0
    if (remaining > 0) counts.set(signature, remaining - 1)
    else if (predicate(effect)) return true
  }
  return false
}

const visible_stat_delta = (effect) =>
  effect?.stat != null && Number.isFinite(Number(effect?.value)) && Number(effect.value) !== 0

/**
 * Prove one family from committed export snapshots. `before`/`after` bracket the cast (or trap trigger); shield
 * additionally uses `followup` after a KNOWN subsequent hit and its positive pre-shield `incoming_damage`.
 * Trap evidence names the observed trigger cell separately because a mover may finish beyond that mid-path cell.
 * @param {{ family: string, target_id: string, before: unknown, after: unknown, followup?: unknown,
 *   incoming_damage?: number, trap_cell?: unknown, trigger_cell?: unknown }} observation
 * @returns {boolean}
 */
export function effect_evidence_observed(observation) {
  const before = fighter_in(observation.before, observation.target_id)
  const after = fighter_in(observation.after, observation.target_id)
  if (!before || !after) return false
  const hp_loss = Number(before.hp) - Number(after.hp)

  if (observation.family === 'damage') return Number.isFinite(hp_loss) && hp_loss > 0
  if (observation.family === 'buff') return gained_effect(before, after, visible_stat_delta)
  if (observation.family === 'displacement') return !same_cell(before.cell, after.cell)
  if (observation.family === 'trap') return hp_loss > 0 && same_cell(observation.trap_cell, observation.trigger_cell)
  if (observation.family === 'shield') {
    const followup = fighter_in(observation.followup, observation.target_id)
    const incoming = Number(observation.incoming_damage)
    if (!followup || !Number.isFinite(incoming) || incoming <= 0 || !gained_effect(before, after)) return false
    const suffered = Number(after.hp) - Number(followup.hp)
    return Number.isFinite(suffered) && suffered >= 0 && suffered < incoming
  }
  return false
}

/**
 * Credit a candidate only when its family proof passes. Ledger shape is class → family → spell ids;
 * the returned value and every nested row are fresh, so failed/duplicate observations cannot mutate history.
 * @param {Record<string, Record<string, string[]>>} ledger
 * @param {{ class_id: string, family: string, spell_id: string, target_id: string, before: unknown,
 *   after: unknown, followup?: unknown, incoming_damage?: number, trap_cell?: unknown, trigger_cell?: unknown }} observation
 * @returns {Record<string, Record<string, string[]>>}
 */
export function effect_evidence_fold(ledger, observation) {
  if (!effect_evidence_observed(observation)) return ledger
  const class_id = String(observation.class_id).toLowerCase()
  const class_ledger = ledger[class_id] ?? {}
  const credited = new Set(class_ledger[observation.family] ?? [])
  credited.add(observation.spell_id)
  return {
    ...ledger,
    [class_id]: { ...class_ledger, [observation.family]: [...credited] },
  }
}

/**
 * Name every catalog-derived family still lacking proof from any of its candidate spells.
 * @param {Record<string, Array<{ family: string, spell_ids: string[] }>>} requirements
 * @param {Record<string, Record<string, string[]>>} ledger
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function effect_evidence_verdict(requirements, ledger) {
  const missing = Object.entries(requirements).flatMap(([class_id, rows]) =>
    rows
      .filter((row) => !row.spell_ids.some((spell_id) => (ledger[class_id]?.[row.family] ?? []).includes(spell_id)))
      .map((row) => `${class_id}/${row.family}:[${row.spell_ids.join('|')}]`)
  )
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
