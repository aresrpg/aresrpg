// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/result_record.js — THE MONOTONIC RESULT RECORD (#1993 WP4): one home for the terminal facts a fight
// produces (outcome kind · winner · the run standing · xp · loot) and for the law that governs how late
// evidence is allowed to touch them.
//
// WHY A FOLD AND NOT A SELECTOR. Every other fight-visible fact is a pure projection of the current state, so
// it can be re-derived at any moment. A RESULT cannot: its evidence arrives over four independent transports
// that finish in no fixed order — the ResultOpened receipt, the ItemMinted rows, the FightResult object read,
// and the chain-terminal settle read — and each one answers only part of the question. "Latest wins" makes the
// card flicker; "first wins" throws away the exact instance ids that arrive last. Monotonic accumulation is the
// only rule that survives both, and accumulation needs memory. So this is a fold, and the record it produces is
// the one thing consumers read.
//
// TWO LIFETIMES, ONE RECORD TYPE. The full record — loot included — is folded by the game store's
// `fight_result` slice, because the terminal card MUST outlive the fight teardown that destroys the core's
// state (game.js:245 — the same reason `fight_summary` is a separate persistent slice), and because the
// settlement evidence only arrives after that teardown. `fight_visible_view.result` serves the LIVE half in
// the same shape and vocabulary, built per-projection from the fight state it can see. One direction, always:
// view → slice, evidence → slice, never slice → view.
//
// STATED SCOPE. The ratchet below is real wherever the record ACCUMULATES — which today is the slice, where
// the loot transports land. The live view is a pure projection with no memory, so its half of the record is
// monotonic within one commit and no further; giving it an across-time latch means folding the terminal
// evidence in the core that owns the committed board, which `visible_facts.js` records as its own train.

/** A fact is UNKNOWN when it is null/undefined, or an empty collection. Absence is not an answer. */
const unknown = (value) => value == null || (Array.isArray(value) && value.length === 0)

/** The empty record — every fact unknown, nothing committed, nothing in dispute. */
export const empty_result = () => ({
  /** 'victory' | 'defeat' | 'room_clear' | null — the discriminated union every terminal surface branches on. */
  kind: null,
  /** the winning TEAM index (0 = the player team), or null while undecided. */
  winner: null,
  /** { room, rooms_total, last_room } — WHERE in the run this result stands, which is what separates a terminal
   *  card from a room recap. Committed with the kind that implies it. */
  run: null,
  /** experience the chain paid this seat (the ResultOpened receipt's own number). */
  xp: null,
  /** how many loot units the chain rolled — the SKELETON COUNT, deliberately a separate fact from `loot`
   *  (finding row 68: a placeholder must never be written into the canonical loot list, or the list's own
   *  monotonicity has to reason about rows that are not drops). A genuine zero is the number 0. */
  loot_units: null,
  /** the certified drops, id-keyed and complete. Rows only ever ADD or gain fields — see `commit_loot`. */
  loot: [],
  /** which home first answered each committed fact — the precedence that used to be consumed silently. */
  provenance: {},
  /** DISAGREEMENTS, retained as DATA. A regression is never silently dropped and never silently applied: the
   *  committed value stands and the offer is recorded here for the operator (and for the tests that assert a
   *  transport is lying). Never read by a rendering surface. */
  conflicts: [],
})

/** Structural equality for the scalars and small plain objects the record holds. */
const same_value = (a, b) => {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => same_value(a[k], b[k]))
}

/**
 * THE MONOTONICITY GUARD — the one law this module exists to state.
 *
 * Within one fight's lifetime a fact that has COMMITTED never regresses to unknown or to a poorer value. Late
 * evidence may only ADD. Concretely, for each offered fact:
 *   ① offered unknown            → ignored. Absence is a transport that has not caught up, never proof that
 *                                  nothing happened (a FightResult read at the tail of settlement legitimately
 *                                  observes an already-drained `rolled`).
 *   ② nothing committed yet      → commit it, and record WHICH home answered.
 *   ③ committed, offer agrees    → no-op (idempotent replay is free).
 *   ④ committed, offer disagrees → the committed value STANDS and the disagreement lands on `conflicts`.
 *
 * Rule ④ is what makes this honest rather than merely stable: "last writer wins" hides the contradiction and
 * "first writer wins" pretends there wasn't one. The record keeps its answer AND the evidence against it.
 *
 * @param {ReturnType<typeof empty_result>} record @param {string} key @param {any} offered
 * @param {string} source the transport that offered it (receipt · minted · object_read · chain_terminal · view)
 */
export const commit_fact = (record, key, offered, source) => {
  if (unknown(offered)) return record // ①
  const held = record[key]
  if (unknown(held)) return { ...record, [key]: offered, provenance: { ...record.provenance, [key]: source } } // ②
  if (same_value(held, offered)) return record // ③
  return { ...record, conflicts: [...record.conflicts, { key, held, offered, source }] } // ④
}

/** A drop's IDENTITY for accumulation: the exact owned object when one exists, else the exact template, else the
 *  on-chain class. Never the display name — two transports spell the same drop's name differently, and that is
 *  precisely the kind of disagreement this record must survive rather than fork on. */
const loot_key = (row) => String(row?.item_id ?? row?.template_id ?? row?.item_type ?? '')

/** The templates this record already knows one owned object for. See `commit_loot`'s supersession rule. */
const enumerated_templates = (rows) =>
  new Set(rows.filter((row) => row?.item_id && row?.template_id).map((row) => String(row.template_id)))

/**
 * The loot arm of the same law, applied ROW-WISE instead of wholesale — the shape that makes the three
 * hand-rolled precedence flags this replaced (`loot_resolved`, `loot_instances_resolved` and the
 * adopt-don't-blank empty check) fall out of one rule:
 *   • a row the record has never seen is ADDED — that is the only way loot ever grows;
 *   • a row it holds is ENRICHED field-by-field through `commit_fact`'s law, so the exact `item_id` the
 *     ItemMinted dispatch carries lands on the aggregate row the receipt opened with, in place;
 *   • a row the offer OMITS simply stays. An offered list is evidence about the rows it names and says nothing
 *     about the rest — which is the whole of #1867: a shorter re-read used to un-loot the player.
 * An offered row that CONTRADICTS a committed field (a different quantity for the same drop) leaves the
 * committed row untouched and lands on `conflicts`, carrying its key so the operator can name the drop.
 *
 * EXACT ENUMERATION SUPERSEDES ITS OWN AGGREGATE — the one exception, and it is not a regression. The
 * FightResult's `rolled` declaration and the ItemMinted rows describe the SAME drops at two resolutions: one
 * row per template carrying a quantity, versus one row per owned object. Counting both would double the
 * player's haul, so a template row retires the moment an owned object of that template is known, and an owned
 * object is never demoted back into its aggregate. This is what the old global `loot_instances_resolved` flag
 * was reaching for — stated per template, where the fact actually lives.
 *
 * @param {ReturnType<typeof empty_result>} record @param {any[]} offered @param {string} source
 */
export const commit_loot = (record, offered, source) => {
  if (!offered?.length) return record
  const index = new Map(record.loot.map((row) => [loot_key(row), row]))
  const enumerated = enumerated_templates([...record.loot, ...offered])
  const conflicts = []
  for (const row of offered) {
    const key = loot_key(row)
    if (!key) continue // an identity-less placeholder is not a drop (see `loot_units`)
    if (!row.item_id && enumerated.has(key)) continue // this template is already enumerated exactly
    const held = index.get(key)
    if (!held) {
      index.set(key, { ...row })
      continue
    }
    let merged = held
    for (const [field, value] of Object.entries(row)) {
      if (unknown(value) || value === '') continue
      if (unknown(merged[field]) || merged[field] === '') {
        merged = { ...merged, [field]: value }
        continue
      }
      if (!same_value(merged[field], value))
        conflicts.push({ key: 'loot', template_id: key, field, held: merged[field], offered: value, source })
    }
    index.set(key, merged)
  }
  const loot = [...index.values()].filter((row) => row.item_id || !enumerated.has(loot_key(row)))
  return {
    ...record,
    loot,
    provenance: { ...record.provenance, loot: record.provenance.loot ?? source },
    conflicts: conflicts.length ? [...record.conflicts, ...conflicts] : record.conflicts,
  }
}
