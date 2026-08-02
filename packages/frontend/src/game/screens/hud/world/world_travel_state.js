// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD TRAVEL — the pure derivations behind the sidebar WORLDS panel + the travel modal: a simple "you are
// in <world>" status line + button, backed by a modal with world cards, filtering, level gates, and
// resource/mob details.
//
// THREE pure folds, zero effects (ONE-PIPELINE law — the components render these outputs verbatim):
//   • derive_discovery_binding — the selected character's identity-guarded settled membership.
//   • derive_world_panel — the SELECTED character's location line. IDENTITY-GUARDED: the char-doc poll
//     (useRpcView) keeps its last-landed data across a selection switch and across failed polls, so the
//     doc in hand can belong to a DIFFERENT character. A doc whose id does not match the selected character
//     is DISCARDED (status 'unknown', renders as loading) — the 07-17 "HERE in First Shore for the first
//     roster character" lie is structurally impossible at this seam, whatever the hook serves.
//   • derive_world_cards — the modal's card rows: the seeded catalog (T62_WORLDS) joined with its stamped
//     required_level (chain gate — zones::join_world asserts the same seed value) and the AUTHORED knowledge
//     (band/biome/mob roster/resources — world_corpus.ts, the same join the encyclopedia renders). DERIVED,
//     never invented: a world absent from a source renders that gap honestly (null), exactly like the
//     encyclopedia's world tab.

/** @typedef {'no_character'|'unknown'|'not_in_world'|'in_world'} PanelStatus */

/**
 * Resolve the selected character's settled membership from the character poll.
 * @param {{
 *   character_id: string | null,
 *   documents: Array<{ id?: string, world?: string | null }> | null,
 * }} args
 * @returns {{
 *   world_id: string|null,
 *   document: { id?: string, world?: string|null }|null,
 *   confirmed: boolean,
 * }}
 */
export function derive_discovery_binding({ character_id, documents }) {
  const document =
    character_id && Array.isArray(documents)
      ? (documents.find((candidate) => candidate?.id === character_id) ?? null)
      : null
  // A missing/foreign row or absent field proves NOTHING. In particular, [] is a successful transport response
  // but not proof that this on-chain character is unjoined.
  if (!document || !Object.prototype.hasOwnProperty.call(document, 'world'))
    return { world_id: null, document, confirmed: false }

  if (document.world === null) return { world_id: null, document, confirmed: true }

  if (typeof document.world !== 'string' || !document.world)
    return { world_id: null, document, confirmed: false }

  return { world_id: document.world, document, confirmed: true }
}

/**
 * The selected character's location + level, identity-guarded (see header). `level` is what the modal's
 * lock derivation compares against the join gates, so it obeys the SAME guard — a foreign doc's level
 * must never lock/unlock cards any more than its world may bind the line (one home for the identity check).
 * @param {{
 *   selected_character_id: string | null,
 *   doc: { id?: string, world?: string | null, level?: number | null } | null,
 * }} args
 * @returns {{ status: PanelStatus, world_id: string | null, level: number | null }}
 */
export function derive_world_panel({ selected_character_id, doc }) {
  if (!selected_character_id) return { status: 'no_character', world_id: null, level: null }
  // The guard: only a doc PROVEN to be the selected character's may bind the line. A missing doc (not yet
  // polled / not yet indexed) and a foreign doc (stale keep-last-good data) both read as honest unknown.
  if (!doc || doc.id !== selected_character_id) return { status: 'unknown', world_id: null, level: null }
  const level = Number(doc.level ?? 1) // create-default mirror — a proven doc without the field is level 1
  return doc.world
    ? { status: 'in_world', world_id: doc.world, level }
    : { status: 'not_in_world', world_id: null, level }
}

/**
 * @typedef {{
 *   id: string, label: string,
 *   biome: string | null, band: [number, number] | null,
 *   required_level: number | null,
 *   here: boolean, locked: boolean,
 *   mob_count: number | null, boss_count: number | null, resource_count: number | null,
 * }} WorldCard
 */

/**
 * The travel modal's card rows, sorted by the REAL join gate (then band floor) so progression reads
 * top-to-bottom. Lock law mirrors the chain + the old switcher exactly: locked ONLY once the stamped
 * required_level AND the character's level are both known and level < gate — an unknown never
 * pre-locks (no fabricated locks while /v1 lags).
 * @param {{
 *   worlds: { id: string, label: string }[],
 *   required_level_by_world: Map<string, number>,
 *   corpus_of: (id: string) => (import('../../../../pages/encyclopedia/world_corpus').CorpusWorld | undefined),
 *   my_level: number | null,
 *   current_world_id: string | null,
 * }} args
 * @returns {WorldCard[]}
 */
export function derive_world_cards({ worlds, required_level_by_world, corpus_of, my_level, current_world_id }) {
  const is_boss = (role) => role === 'boss' || role === 'dungeon_boss'
  return worlds
    .map((world) => {
      const corpus = corpus_of(world.id)
      const required_level = required_level_by_world.get(world.id) ?? null
      const here = world.id === current_world_id
      const locked = !here && required_level != null && my_level != null && my_level < required_level
      return {
        id: world.id,
        label: world.label,
        biome: corpus?.biome ?? null,
        band: corpus?.band ?? null,
        required_level,
        here,
        locked,
        mob_count: corpus ? corpus.mobs.length : null,
        boss_count: corpus ? corpus.mobs.filter((m) => is_boss(m.role)).length : null,
        resource_count: corpus ? corpus.resources.length : null,
      }
    })
    .sort(
      (a, b) =>
        (a.required_level ?? a.band?.[0] ?? Number.MAX_SAFE_INTEGER) -
        (b.required_level ?? b.band?.[0] ?? Number.MAX_SAFE_INTEGER)
    )
}

/** The modal's one light filter (deliberately light, not bloated): all worlds, or only the ones the
 *  selected character can enter today (never filters out HERE — you are already there).
 * @param {WorldCard[]} cards @param {{ accessible_only: boolean }} args @returns {WorldCard[]} */
export function filter_world_cards(cards, { accessible_only }) {
  return accessible_only ? cards.filter((card) => !card.locked) : cards
}
