// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRESENCE APPEARANCE REVISION (#2171) — a CACHE-INVALIDATION SIGNAL, never a fact.
//
// #553's transport ruling stands untouched: a peer's worn cosmetics and equipped pet are OWNERSHIP facts, and
// ownership facts come from chain state (`/v1/characters` via remote_character_cache.js), never from a peer's
// own word. The gap this closes is LATENCY, not truth: before this, an observer only re-read a peer's row when
// its ~60s cache TTL expired, so an equip took up to a minute to appear on someone else's screen.
//
// The signal is a bare NUMBER. It says exactly one thing — "my chain row changed, your cached copy of it is
// stale" — and it is structurally incapable of saying WHAT changed: there is no slug, no item id, no rendering
// hint on the wire. An observer that receives it can only do one thing with it: re-read `/v1`. A lying peer can
// therefore only ever cost itself a refetch; it can never render a pet it does not own.
//
// The revision is assigned per distinct appearance SIGNATURE for the life of the tab, so it is idempotent and
// order-independent (`_publish_state` and the equip watcher both call it, in any order, with any character) —
// callers compare revisions for INEQUALITY, never for ordering, so a repeat of a previous appearance reusing
// its previous number is correct: it differs from whatever the observer last applied, which is the whole
// question being asked.

/**
 * The appearance-relevant half of a character's `/v1` row, folded to an opaque local string — the fields whose
 * change makes every observer's cached row stale. LOCAL ONLY: this string never rides the wire (it names item
 * ids), it only decides whether the published revision moves. The pet is #2171's reported case; worn cosmetics
 * live on the same fetched row and are invalidated by the same signal, so they are not a second rule.
 * @param {any} character the selected character's `/v1` doc (pet/pet_equipped/worn), or null
 * @returns {string}
 */
export function appearance_signature(character) {
  if (!character) return ''
  const worn = Object.entries(character.worn ?? {})
    .map(([category, row]) => `${category}=${/** @type {any} */ (row)?.item_id ?? ''}`)
    .sort()
    .join(',')
  // The exact equipped-pet identity pair pet_companion_resolver.js resolves from — `pet_equipped: false` with a
  // stale pet object still on the doc is the same appearance as no pet at all, so it must fold to it here too.
  const pet = character.pet_equipped === true ? (character.pet?.item_id ?? character.pet?.id ?? '') : ''
  return `${worn}|${pet}`
}

/** @type {Map<string, number>} appearance signature → its published revision, for the life of this tab. */
const revisions = new Map()
let issued = 0

/**
 * The revision to publish for `character`. Same appearance → same number (idempotent, call-order independent);
 * a real equip/unequip → a number the observer has not applied yet, which is its cue to re-read `/v1`.
 * @param {any} character @returns {number}
 */
export function appearance_rev(character) {
  const signature = appearance_signature(character)
  const known = revisions.get(signature)
  if (known !== undefined) return known
  issued += 1
  revisions.set(signature, issued)
  return issued
}

/**
 * Republish presence whenever the selected character's appearance-relevant chain fields actually change — the
 * SAME "only on a real transition" shape the dungeon-session subscription already publishes on, for the equip
 * that reconciles into the roster (equip_state_refresh.js writes it; every write lands as a STATE_UPDATED).
 * The revision projection is idempotent, so this fires ONE publish per real change, never one per emission.
 * @param {{ events: { on:Function, off:Function }, character_of: () => any, publish: () => void }} deps
 * @returns {() => void} unsubscribe
 */
export function watch_appearance_changes({ events, character_of, publish }) {
  let published = appearance_rev(character_of())
  const on_update = () => {
    const rev = appearance_rev(character_of())
    if (rev === published) return
    published = rev
    publish()
  }
  events.on('STATE_UPDATED', on_update)
  return () => events.off('STATE_UPDATED', on_update)
}
