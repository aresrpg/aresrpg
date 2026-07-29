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
// `decode_status_value` is the ONE decoder of that centering (decode-once law), called by EVERY door the wire
// enters the client through — the snapshot read below, and the receipt's action envelope
// (`inputs.self_status_from_effect`, #983). Both write the same per-fighter status home, so both must strip it
// or the home carries two dialects: every downstream reader — the effect badges, the range-bonus fold — sees a
// real SIGNED delta and never touches 32768. Displaying the raw wire is exactly the `-32793 Percent Damage`
// bug; folding it is the `+1 Range` buff that granted 32769 range. Non-signed kinds pass through untouched:
// their `value` is a plain magnitude.
const SIGNED_SHIFT = 32768
const SIGNED_KINDS = new Set([9, 11]) // K_ALTER_STAT · K_ALTER_RESIST (spell_effect.move)

/** Does this status kind ride its value CENTERED on the wire? The one membership test for the encoding. */
export const is_signed_status_kind = (kind) => SIGNED_KINDS.has(Number(kind))

/**
 * A status row's chain `value` → the real signed delta. Signed kinds strip the 32768 centering; every other
 * kind (and an absent value) passes through verbatim.
 * @param {number} kind @param {number | null} value @returns {number | null}
 */
export const decode_status_value = (kind, value) =>
  value == null || !is_signed_status_kind(kind) ? value : value - SIGNED_SHIFT

/**
 * The exact inverse — a real signed delta → the u64 the chain rides it as. Two callers, both minting rows the
 * chain-dialect doors then read: the local mock chain (its receipts must be byte-identical to a minted row,
 * #983) and the frontend's authored→chain corpus mint (`fight-spells-core.mint_authored_spell`, #1166 — the
 * published corpus states the AUTHORED magnitude, so every door handing it to the sim's normalizer centers it
 * first). Nothing ENCODES toward the real chain: a transaction's own effects are authored on chain.
 * @param {number} kind @param {number | null} delta @returns {number | null}
 */
export const encode_status_value = (kind, delta) =>
  delta == null || !is_signed_status_kind(kind) ? delta : delta + SIGNED_SHIFT

const fields_of = (value) => value?.fields ?? value ?? {}
const num = (value) => (value == null || value === '' ? null : Number(value))

/**
 * THE ONE READER of a status row's OWNER (#1444). A `FighterStatus.fighter` is a chain u64 — a seat index, or
 * `1000 + mob index` (cast.move `fid_of`, twin-pinned below). It arrives over the wire as a number or a decimal
 * string, and it is the ONLY thing that says whose HUD row a status belongs on.
 *
 * ABSENCE IS NOT SEAT 0. `Number(null)`, `Number('')` and `Number(false)` are all 0, so a bare `Number(row.fighter)`
 * silently attributed every owner-less row to the FIRST PARTICIPANT — which, in a solo fight, is the player, on
 * their own card. That is the shape of #1444: a mob's authored self-buff ("+20% Damage · 1 turn", the same family
 * Razkin's live +25% row belongs to) rendering on a level-1 character that has no buff spell at all. An
 * unreadable owner is DROPPED, never guessed — a status nobody can attribute is not a status.
 * @param {unknown} raw @returns {number | null} the fid, or null when the wire did not state one
 */
export const fighter_fid = (raw) => {
  // ACCEPT-LIST, not a deny-list: `Number()` maps `[]`, `false` and `''` to 0 just as happily as it maps `'0'`,
  // so only the two shapes the wire actually uses are readable at all.
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  if (raw === '') return null
  const fid = Number(raw)
  return Number.isInteger(fid) && fid >= 0 ? fid : null
}

/**
 * Read ALL active fighter-status rows from a raw json:true Fight document — the chain corpus is already generic
 * (FighterStatus{ fighter, kind, effect, remaining_turns, source } — spell_board.move, mirrored by
 * sim/effect_board.js). Was invisibility-only (kind 27); now carries EVERY status kind with its chain duration so
 * the HUD renders every effect badge, not just the haze. The effect ints (element/stat/chance) ride RAW — the
 * same passthrough convention `element` uses on a mob; the badge component interprets them downstream. `value`
 * is the ONE exception: it is decoded HERE (see decode_status_value above) because its encoding is a property
 * of the wire, not of any one reader.
 * `source` is the chain's own attribution field (`FighterStatus.source` — the caster's board fid): the ONE
 * projection every status surface derives from states WHO applied the row, so nothing has to re-guess it.
 * @param {any} json
 * @returns {{ fighter:number, kind:number, remaining_turns:number, element:number|null, value:number|null, stat:number|null, chance:number|null, source:number|null }[]}
 */
export function read_fighter_statuses(json) {
  const fx = fields_of(json?.fx)
  const rows = Array.isArray(fx.statuses) ? fx.statuses : []
  const out = []
  for (const raw of rows) {
    const row = fields_of(raw)
    const effect = fields_of(row.effect)
    const fighter = fighter_fid(row.fighter)
    const kind = Number(row.kind ?? effect.kind)
    const remaining_turns = Number(row.remaining_turns ?? effect.turns ?? 0)
    if (fighter != null && Number.isFinite(kind) && remaining_turns > 0)
      out.push({
        fighter,
        kind,
        remaining_turns,
        element: num(effect.element),
        value: decode_status_value(kind, num(effect.value)),
        stat: num(effect.stat),
        chance: num(effect.chance),
        source: num(row.source),
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
    // The SAME owner reader the wire decode uses — this door is also reached with sim-projected rows, so an
    // owner-less row must die here too rather than land on seat 0 (#1444).
    const fighter = fighter_fid(row?.fighter)
    if (fighter == null) continue
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
      source: row.source ?? null,
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
