// Bounded post-fight Character projection reconcile. The settlement receipt updates the shared roster
// immediately, then this waits for the read layer to expose at least that XP total before replacing the
// character from `/v1`. The caller owns the event wiring + concrete read/store dependencies.

/** Mirror the CompassStrip post-write projection budget: 4 fresh reads across a 3.2-second wait budget. */
export const CHARACTER_RECONCILE_TRIES = 4
export const CHARACTER_RECONCILE_INTERVAL_MS = 800

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {any} row
 * @param {number} expected_experience
 */
export function character_experience_reconciled(row, expected_experience) {
  const experience = Number(row?.experience ?? NaN)
  return Number.isFinite(experience) && experience >= expected_experience
}

/**
 * Enrich a `/v1` roster card with the targeted chain-direct Character read without letting the immutable base
 * `Character.experience` replace live `Progression.xp`. XP/level are read-model-owned; the enrichment supplies
 * the remaining stats/cosmetics only.
 * @param {any} character
 * @param {any} enrichment
 */
export function merge_character_enrichment(character, enrichment) {
  if (!enrichment) return character
  return {
    ...character,
    ...enrichment,
    experience: character.experience,
    level: character.level,
  }
}

/**
 * Re-read one Character until `/v1` carries the settlement's absolute XP floor, then immutably replace that
 * row in the shared roster. Reads are fresh/cache-bypassed at the production adapter; this pure core accepts
 * dependencies so the event→fetch→store contract is unit-testable without booting the engine.
 * @param {{ character_id:string, expected_experience:number }} target
 * @param {{
 *   read_projection:(character_id:string)=>Promise<any>,
 *   read_roster:()=>any[],
 *   write_roster:(characters:any[])=>void,
 *   map_projection:(row:any)=>any,
 *   wait?:(ms:number)=>Promise<void>,
 *   tries?:number,
 *   interval_ms?:number,
 * }} deps
 * @returns {Promise<boolean>} true once a confirmed projection replaced the store row
 */
export async function reconcile_character_projection(
  { character_id, expected_experience },
  {
    read_projection,
    read_roster,
    write_roster,
    map_projection,
    wait = sleep,
    tries = CHARACTER_RECONCILE_TRIES,
    interval_ms = CHARACTER_RECONCILE_INTERVAL_MS,
  }
) {
  const expected = Number(expected_experience)
  if (!character_id || !Number.isFinite(expected)) return false

  for (let attempt = 0; attempt < tries; attempt += 1) {
    await wait(interval_ms)
    const row = await read_projection(character_id).catch(() => null)
    if (!character_experience_reconciled(row, expected)) continue

    const characters = read_roster()
    const index = Array.isArray(characters) ? characters.findIndex((character) => character?.id === character_id) : -1
    if (index === -1) return false
    const next = characters.slice()
    next[index] = { ...characters[index], ...map_projection(row) }
    write_roster(next)
    return true
  }
  return false
}
