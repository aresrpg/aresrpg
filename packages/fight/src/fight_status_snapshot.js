// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Presentation-only decode of the authoritative Fight.fx fighter-status rows omitted by @aresrpg/sdk/fight.
// The raw json:true Fight document still carries these nested fields, so the frontend can bind status visuals to
// chain duration without widening the SDK surface owned by another lane.

export const INVISIBILITY_STATUS_KIND = 27
export const MOB_FIGHTER_ID_BASE = 1000

// ── THE SIGNED-EFFECT WIRE DECODE (issue #886) ────────────────────────────────────────────────────────
// `Effect.value` is a u64 on chain, but alter_stat (kind 9) and alter_resist (kind 11) author BOTH signs, so
// for exactly those two kinds the mint stores the delta CENTERED at 32768 (`value = 32768 + delta` — the same
// RES_SHIFT convention gear ItemStatistics and mob resistances use; `FLAG_NEGATIVE` is DERIVED from the
// delta's sign, never an independent fact). Captured live 2026-07-26 (testnet MobTemplates, `sui client
// object`): Razkin `0x4a00a579…be97` authors +25% damage → chain `value "32793"`, flags 0; Bonelet
// `0xb80ade53…d444` authors −17 agility → `value "32751"`, flags 8; Kraken Leviathan `0x89072bd3…af56`
// −7 range → `32761`, flags 8.
//
// This function is where that wire ENTERS the client, so it is the ONE place the centering is stripped
// (decode-once law): every downstream reader — the effect badges, the range-bonus prediction fold — sees a
// real SIGNED delta and never touches 32768. Displaying the raw wire is exactly the `-32793 Percent Damage`
// bug. Non-signed kinds pass through untouched: their `value` is a plain magnitude.
const SIGNED_SHIFT = 32768
const SIGNED_KINDS = new Set([9, 11]) // K_ALTER_STAT · K_ALTER_RESIST (spell_effect.move)

/**
 * A status row's chain `value` → the real signed delta. Signed kinds strip the 32768 centering; every other
 * kind (and an absent value) passes through verbatim.
 * @param {number} kind @param {number | null} value @returns {number | null}
 */
export const decode_status_value = (kind, value) =>
  value == null || !SIGNED_KINDS.has(Number(kind)) ? value : value - SIGNED_SHIFT

const fields_of = (value) => value?.fields ?? value ?? {}
const num = (value) => (value == null || value === '' ? null : Number(value))

/**
 * Read ALL active fighter-status rows from a raw json:true Fight document — the chain corpus is already generic
 * (FighterStatus{ fighter, kind, effect, remaining_turns, source } — spell_board.move, mirrored by
 * sim/effect_board.js). Was invisibility-only (kind 27); now carries EVERY status kind with its chain duration so
 * the HUD renders every effect badge, not just the haze. The effect ints (element/stat/chance) ride RAW — the
 * same passthrough convention `element` uses on a mob; the badge component interprets them downstream. `value`
 * is the ONE exception: it is decoded HERE (see decode_status_value above) because its encoding is a property
 * of the wire, not of any one reader.
 * @param {any} json
 * @returns {{ fighter:number, kind:number, remaining_turns:number, element:number|null, value:number|null, stat:number|null, chance:number|null }[]}
 */
export function read_fighter_statuses(json) {
  const fx = fields_of(json?.fx)
  const rows = Array.isArray(fx.statuses) ? fx.statuses : []
  const out = []
  for (const raw of rows) {
    const row = fields_of(raw)
    const effect = fields_of(row.effect)
    const fighter = Number(row.fighter)
    const kind = Number(row.kind ?? effect.kind)
    const remaining_turns = Number(row.remaining_turns ?? effect.turns ?? 0)
    if (Number.isInteger(fighter) && fighter >= 0 && Number.isFinite(kind) && remaining_turns > 0)
      out.push({
        fighter,
        kind,
        remaining_turns,
        element: num(effect.element),
        value: decode_status_value(kind, num(effect.value)),
        stat: num(effect.stat),
        chance: num(effect.chance),
        ...(num(effect.flags) != null ? { flags: num(effect.flags) } : {}),
      })
  }
  return out
}

/**
 * Map Move's numeric fighter ids (seat, or 1000 + mob index) onto renderer entity ids, PRESERVING each status row
 * (kind + duration + effect ints). Was a per-entity collapse to the longest invisibility duration; now every row
 * survives as its own entry — the fold groups them per fighter into `statuses` (a fighter may carry a DoT + a buff
 * + invisibility at once).
 * @param {{ fighter:number, kind:number, remaining_turns:number, element?:number|null, value?:number|null, stat?:number|null, chance?:number|null }[]} rows
 * @param {(string | null | undefined)[]} participant_ids
 * @param {number} mob_count
 * @returns {{ entity_id:string, kind:number, remaining_turns:number, element:number|null, value:number|null, stat:number|null, chance:number|null }[]}
 */
export function status_snapshot_entities(rows, participant_ids, mob_count) {
  const out = []
  for (const row of rows ?? []) {
    const fighter = Number(row?.fighter)
    const mob_idx = fighter - MOB_FIGHTER_ID_BASE
    const entity_id =
      fighter >= MOB_FIGHTER_ID_BASE
        ? mob_idx >= 0 && mob_idx < mob_count
          ? `mob-${mob_idx}`
          : null
        : (participant_ids[fighter] ?? null)
    if (!entity_id) continue
    out.push({
      entity_id,
      kind: Number(row.kind) || 0,
      remaining_turns: Number(row.remaining_turns) || 0,
      element: row.element ?? null,
      value: row.value ?? null,
      stat: row.stat ?? null,
      chance: row.chance ?? null,
      ...(row.flags != null ? { flags: row.flags } : {}),
    })
  }
  return out
}

/** Status rows newly applied (or refreshed to a longer duration) between two monotonic presentation snapshots. */
export function new_invisibility_statuses(current, previous = []) {
  const before = new Map()
  for (const row of previous ?? [])
    before.set(row.entity_id, Math.max(before.get(row.entity_id) ?? 0, Number(row.remaining_turns) || 0))
  return (current ?? []).filter(
    (row) => row?.entity_id && Number(row.remaining_turns) > (before.get(row.entity_id) ?? 0)
  )
}
