// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD-FIGHT CLAIM SCAN — the dev rig's "find a claimable mob group" loop (`__dev_start_world_fight`,
// embed_voxel_dev.js), as a driver over an INJECTED attempt.
//
// WHY ITS OWN MODULE. Inline in a window hook, a policy that decides between "stop now" and "550 more
// dry-runs" could only be exercised by a browser — and it showed: the scan re-learned one ACCOUNT-WIDE fact
// (this character is not in the seat's kiosk, so nothing anywhere is claimable) once per candidate and spent
// the whole 420s harness ceiling on it, so a stranded seat and an honest "no claimable group in reach"
// answer were the same indistinguishable timeout (#1263). With the attempt injected, every refusal class is
// a unit test.

import { parse_move_abort } from '../core/abort_copy.js'

/** How many byte-identical initial refusals read as an account-wide failure (the unclassified fallback). */
export const uniform_refusal_sample_size = 5

/**
 * Return the exact refusal shared by the complete initial sample, or null when the sample is incomplete/mixed.
 * The SAFETY NET under the scope taxonomy below: a refusal class nobody has mapped yet still stops the scan
 * once it has proven itself uniform, instead of running the full candidate set.
 * @param {string[]} refusal_reasons
 * @param {number} sample_size
 */
export function first_uniform_refusal(refusal_reasons, sample_size = uniform_refusal_sample_size) {
  if (sample_size < 1 || refusal_reasons.length < sample_size) return null
  const first_reason = refusal_reasons[0]
  return refusal_reasons.slice(1, sample_size).every((reason) => reason === first_reason) ? first_reason : null
}

/**
 * Move (module, code) → the SCOPE of that refusal. Read through the one abort-decoder home, so discrimination
 * is NUMERIC (module + code) and never a message substring — an abort's Move constant NAME is not in the
 * receipt. Each row cites the constant its scope comes from; anything unmapped stays `spawn`, the safe
 * default (a scan that guesses `zone` could skip the one claimable group in reach).
 * @type {Record<string, Record<number, 'character'|'zone'>>}
 */
const REFUSAL_SCOPES = {
  // zones.move — the claim door's own gates.
  zones: {
    101: 'character', // ELevelTooLow — the seat is below the world's required_level: no zone will ever claim
    102: 'character', // ENotInWorld — the seat is not in this world (join it first)
    103: 'character', // ENoCheckpoint — the seat has no checkpoint in this world
    112: 'zone', // EMemberZone — this zone derives MEMBER LISTS: the plain door refuses EVERY row of it
  },
  // world.move — the checkpoint/travel gate: a zone the seat cannot reach refuses all of its groups alike.
  world: {
    120: 'zone', // ECheckpointFuture
    121: 'zone', // ETravelTooFar
  },
  fight: {
    111: 'character', // ECharacterMarked — an unopened outcome sits on the character: open it before any claim
  },
  fight_latch: {
    103: 'character', // ECharacterInFight — the character is already seated in a live fight
  },
}

/**
 * How much of the candidate set one refusal disqualifies:
 *   character → nothing anywhere is claimable by this seat — stop the scan and report the strand.
 *   zone      → the seat cannot claim in that zone at all — skip its remaining groups for free.
 *   spawn     → this group alone is unavailable — try the next one.
 * A client-side pre-flight refusal declares its own scope on the thrown error (`refusal_scope`), because it
 * never reaches the chain and so carries no abort to decode.
 * @param {any} error
 * @returns {'character'|'zone'|'spawn'}
 */
export function refusal_scope(error) {
  const declared = error?.refusal_scope
  if (declared === 'character' || declared === 'zone' || declared === 'spawn') return declared
  const abort = parse_move_abort(error)
  return (abort && REFUSAL_SCOPES[abort.module]?.[abort.code]) ?? 'spawn'
}

/** `${zx}:${zy}` — the zone a candidate belongs to (null coords = its own bucket, never skipped as a group). */
const zone_key = (candidate) =>
  candidate.zx == null || candidate.zy == null ? null : `${candidate.zx}:${candidate.zy}`

/**
 * Walk the candidate groups until one claim succeeds. `attempt` is the ONLY effect: it performs the real
 * claim+create for one candidate and resolves its fight id (falsy = nothing claimed, throw = refusal).
 *
 * @param {object} args
 * @param {{ spawn_id: string|number, template_id: string, zx?: number|null, zy?: number|null }[]} args.candidates
 * @param {(candidate: any) => Promise<string|null|undefined>} args.attempt
 * @param {(line: string) => void} [args.log]
 * @returns {Promise<{ fight_id: string|null, verdict: 'mounted'|'strand'|'uniform'|'exhausted',
 *   attempted: number, remaining: number, reason: string|null,
 *   tally: { character: number, zone: number, spawn: number }, skipped_zones: number }>}
 */
export async function scan_for_claimable_group({ candidates, attempt, log = () => {} }) {
  /** @type {string[]} */
  const refusal_reasons = []
  /** Zones a zone-scoped refusal already disqualified — their remaining groups cost nothing. */
  const dead_zones = new Set()
  const tally = { character: 0, zone: 0, spawn: 0 }
  let attempted = 0
  let remaining = 0
  const verdict_of = (verdict, fight_id = null, reason = null) => ({
    fight_id,
    verdict,
    attempted,
    remaining,
    reason,
    tally,
    skipped_zones: dead_zones.size,
  })

  for (const [index, candidate] of candidates.entries()) {
    const zone = zone_key(candidate)
    if (zone !== null && dead_zones.has(zone)) continue
    remaining = candidates.length - index - 1
    attempted += 1
    try {
      const fight_id = await attempt(candidate)
      if (fight_id) return verdict_of('mounted', fight_id)
    } catch (error) {
      const reason = String(error?.message ?? error)
      const scope = refusal_scope(error)
      tally[scope] += 1
      // CHARACTER scope: this seat cannot claim ANYWHERE. One refusal is the whole answer — every further
      // dry-run would re-learn the same fact and turn an honest verdict into a harness timeout (#1263).
      if (scope === 'character') {
        log(`the character itself is refused; stopping before ${remaining} more spawns — ${reason.slice(0, 120)}`)
        return verdict_of('strand', null, reason)
      }
      // ZONE scope: the seat cannot claim in this zone at all — its other groups are free to skip.
      if (scope === 'zone' && zone !== null) {
        dead_zones.add(zone)
        log(`zone ${zone} is out of reach; skipping its remaining groups — ${reason.slice(0, 80)}`)
        continue
      }
      if (refusal_reasons.length < uniform_refusal_sample_size) refusal_reasons.push(reason)
      const uniform_reason = first_uniform_refusal(refusal_reasons)
      if (uniform_reason !== null) {
        log(
          `${uniform_refusal_sample_size} identical refusals; stopping before ${remaining} more spawns — ${uniform_reason.slice(0, 80)}`
        )
        return verdict_of('uniform', null, uniform_reason)
      }
      log(`spawn ${candidate.spawn_id} refused — next: ${reason.slice(0, 80)}`)
    }
  }
  remaining = 0
  return verdict_of('exhausted')
}
