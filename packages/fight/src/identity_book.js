// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/identity_book.js — THE ROSTER IDENTITY BOOK (#1993 WP3): the one home for fight-visible identity.
//
// ONE id-keyed book. Every fight-visible identity fact — name, seat/team, level, class & appearance refs — is
// resolved EXACTLY ONCE here, off the canonical inputs, before any surface reads it. The key is the stable entity
// id every fight surface already joins on; roster ORDER is presentation metadata and never a join key (#1608).
//
// THE LAW — ABSENCE STAYS AN ID. A row whose real name cannot be resolved carries `name: null`. It never carries a
// substitute string, because a substitute invented at a consumer is not identity: it is that consumer's guess, and
// two consumers guess differently. `display_id` is the honest ID to show instead — the short character id for a
// player, the on-chain template id for a mob — and `label` is that one rule applied once (`name ?? display_id`),
// so no surface re-implements it and no two surfaces can disagree.
//
// THE CLASS DEFECT THIS KILLS (#1865). One unresolvable player used to render under THREE identities in the same
// frame: the live projection showed an OWNER-ADDRESS slice (`0xdee0…ad38`), the end-fight card showed a
// CHARACTER-ID slice (`0xdee0abc…89012`), the combat log showed a translated "unknown fighter". An address is not
// an identity — a wallet owns several characters (#929) — and another creature's name is not an identity: a mixed
// pack named by its shared group template renames living fighters (#1865). Both are now unrepresentable here:
// this book has no address arm and no group-template arm, and an unresolved row's `label` IS its id.
//
// Pure: plain data in, a frozen-by-the-view plain object out. No store read, no IO, no `now`.

import { experience_to_level } from '@aresrpg/sdk/experience'

import { mob_entity_id, participant_character_id, participant_entity_id } from './fight_control.js'

/**
 * The SHORT ID form of an on-chain object id — the only honest display when a real name genuinely cannot be
 * resolved. One home for the shape, so the end-fight card, the live board and the party surfaces cannot each
 * truncate differently (they did: 7…5 here against a 6…4 address slice in the projection).
 * @param {unknown} id @returns {string}
 */
export const short_id = (id) => {
  const value = String(id ?? '')
  return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`
}

/** A name that is actually a name: a non-empty authored string. Blank/whitespace is absence, not identity. */
const authored_name = (value) => {
  const name = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  return name.length ? name : null
}

/**
 * THE ONE LABEL RULE — the string a surface renders for an identity: its resolved name, else its id. Exported
 * so nothing re-implements it; the view already carries the applied value as `identity.label`.
 * @param {{ name?: string | null, display_id?: string } | null | undefined} row
 */
export const identity_label = (row) => row?.name ?? row?.display_id ?? null

const character_male = (character) => {
  if (typeof character?.male === 'boolean') return character.male
  if (character?.sex === 'male') return true
  if (character?.sex === 'female') return false
  return undefined
}

/** A player's LEVEL off its roster character (the turn card used to hardcode 1, #949). `/v1` serves the stored
 *  progression level once a character has fought (the Progression DF supersedes the frozen genesis fields); my own
 *  `sui.characters` rows carry `experience` only, so the fallback is the same immutable XP curve the chain runs.
 *  No roster row yet (a co-fighter's doc still resolving) → 1, never undefined. */
const character_level = (character) => {
  const stored = Number(character?.level)
  if (Number.isFinite(stored) && stored >= 1) return stored
  const experience = Number(character?.experience)
  return Number.isFinite(experience) && experience > 0 ? experience_to_level(experience) : 1
}

/** The roster edge is deliberately shape-tolerant: owned/enriched cards carry flat `color_N` fields while raw
 *  `/v1` teammate docs carry them under `colors`. All-zero means "use the authored base texture", exactly like the
 *  roam avatar. */
const character_colors = (character) => {
  if (!character) return null
  const nested = Array.isArray(character.colors) ? null : character.colors
  const colors = Array.isArray(character.colors)
    ? character.colors
    : [
        character.color_1 ?? nested?.color_1 ?? 0,
        character.color_2 ?? nested?.color_2 ?? 0,
        character.color_3 ?? nested?.color_3 ?? 0,
      ]
  return colors.some(Boolean) ? colors : null
}

/**
 * One PLAYER seat's identity row. TWO name sources, both authored: the chain escrow row's own name and the
 * canonical roster row's. The owner address is NOT a third source (#929) — a wallet owns several characters, so
 * an address names a purse, not a fighter.
 */
const player_identity = (row, seat, roster_by_id) => {
  const entity_id = participant_entity_id(row)
  const character_id = participant_character_id(row)
  const character = character_id ? roster_by_id.get(character_id) : undefined
  const name = authored_name(row?.name) ?? authored_name(character?.name)
  const display_id = short_id(character_id ?? entity_id)
  const male = character_male(character) ?? character_male(row)
  return {
    id: entity_id,
    is_player: true,
    seat,
    name,
    resolved: name != null,
    display_id,
    label: name ?? display_id,
    team: Number(row?.team ?? 0), // the CHAIN's side (fight.move seats team 1 only in PvP) — never assumed PvM
    level: character_level(character),
    character_id,
    owner: row?.addr,
    class_id: row?.classe || character?.classe || character?.class || undefined,
    sex: male == null ? undefined : male ? 'male' : 'female',
    male,
    hue: 0, // was color_to_hue(0) ≡ 0 — a constant call; the game/data/color edge died with the promotion
    colors: character_colors(character) ?? character_colors(row),
  }
}

/**
 * One MOB's identity row. The species is the carried id-keyed roster's exact template, else this mob's own chain
 * template — the SHARED group template is deliberately absent as a name source (#1865: naming a mixed pack by its
 * primary species renames living fighters). `mob_names` maps a template id to its authored name and is therefore a
 * translation of the id already chosen, not a competing choice of WHICH id.
 */
const mob_identity = (mob, index, mob_roster_by_id, mob_names) => {
  const id = mob_entity_id(index)
  const carried = mob_roster_by_id.get(id) ?? null
  const template = carried?.template_id || mob?.template || id
  const name = authored_name(carried?.name) ?? authored_name(mob_names?.[template])
  return {
    id,
    is_player: false,
    seat: null,
    name,
    resolved: name != null,
    display_id: template,
    label: name ?? template,
    team: 1,
    level: Number(mob?.level) || 1,
    template,
    element: Number(carried?.element ?? mob?.element),
  }
}

/**
 * THE BOOK — entity id → identity row, built once per projection off the adopted board and the fight's ctx.
 * A board that is not adopted yet has no identities to publish and answers with an empty book (absence is data).
 * @param {any} view the adopted board snapshot @param {any} ctx the fight core's ctx input
 * @returns {Record<string, any>} id-keyed identity rows
 */
export const identity_book = (view, ctx = {}) => {
  const roster_by_id = new Map()
  for (const character of ctx?.roster ?? []) if (character?.id != null) roster_by_id.set(String(character.id), character)
  const mob_roster_by_id = new Map()
  for (const identity of ctx?.mob_roster ?? [])
    if (identity?.id != null) mob_roster_by_id.set(String(identity.id), identity)

  const book = {}
  for (const [seat, row] of (view?.escrow ?? []).entries()) {
    const identity = player_identity(row, seat, roster_by_id)
    if (identity.id) book[identity.id] = identity
  }
  for (const [index, mob] of (view?.mobs ?? []).entries()) {
    const identity = mob_identity(mob, index, mob_roster_by_id, view?.mob_names)
    book[identity.id] = identity
  }
  return book
}
