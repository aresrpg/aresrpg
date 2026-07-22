// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP KERNEL — the pure decision legs of the two-actor coop gold row (specs_multiplayer/coop_fight.spec.ts).
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
