// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_start.js — THE START BUTTON'S FOLD: the page's setup state → the arguments
// `create_fight_shim().start()` takes (spec §4.3 / §9 flow 7).
//
// It is the last missing link of an otherwise finished chain: `fight_setup.js` already turns built seats into
// sim entities, `fight_shim.js` already opens the local chain and seeds the production HUD's stores, and the
// page reducer already has its `fight_started` / `fight_stopped` arms. What nothing owned was the join —
// "which characters, wearing what, casting which templates, against which mobs" — so the page had no way to
// press START at all (#883 ⑤). This module is exactly that join and nothing else: every number comes from L1
// (`content.js`), every entity shape from L4 (`fight_setup.js`), and no balance is computed here.
//
// TEMPLATES ARE RAW. `create_sim_chain` runs the sim's own `normalize_spell_templates` over `templates_raw`
// and RECORDS those rows in the capsule, and that normalizer is not idempotent — handing it the already
// normalized map (`fight_spells_data.spells[].template`) would replay every spell inert. So the rows here are
// the corpus' own; the deck ids and the invested spell levels are re-keyed onto that same id space, because
// the page persists spell levels by `name_key` (stable across republishes) while a cast names the spell by
// its on-chain object id. One translation, one place — `cast_id_of` below is that place.

import { decode } from '@aresrpg/fight/los'

import { class_spells } from '../game/screens/hud/fight-spells.js'
import { get_spell_corpus } from '../game/data/spell_corpus.js'

import { build_mob, build_seat, mob_spell_rows, resolve_loadout } from './content.js'
import { build_teams } from './fight_setup.js'

/** Why a start was refused. The page prints the matching `simulator.fight_blocked_*` line. */
export const START_BLOCKED = {
  EMPTY_ROSTER: 'empty_roster',
  NO_MOBS: 'no_mobs',
}

/**
 * THE ID A COMMITTED CAST NAMES (#931). The production board stages `object_id` — the on-chain SpellTemplate
 * shared object `act_cast` takes — and the simulator routes those very staged rows through the sim chain's
 * `commands_from_staged`, which reads `spell_template_id` verbatim as the spell to cast. So the local chain's
 * templates, decks and spell levels must live in the OBJECT-ID space too. Keyed by the corpus row's authored
 * slug instead, every player cast named a spell the ctx could not resolve: the turn committed, the AP was
 * spent and not one effect folded. Mobs never showed it — their ids are minted by `mob_spell_id` on both the
 * deck and the template side, and the AI casts by deck id rather than through the staged-action door.
 * @param {Record<string, any>} row  a raw corpus row
 * @returns {string}  '' when the row carries no object id — a spell no cast can name
 */
const cast_id_of = (row) => String(row?.object_id ?? '')

/**
 * The castable rows for one character: its class' spells whose unlock level it has reached, joined to the RAW
 * corpus row each one normalizes from, re-keyed onto the cast id space. A row the corpus no longer carries is
 * dropped, and so is one still awaiting its deployment receipt — the deck must never name a template the
 * chain's ctx cannot resolve, and a receipt-less row is exactly that (the board stages no id for it either).
 * @param {{ class_id: string, level: number, spell_levels?: Record<string, number> }} character
 * @param {Array<Record<string, any>>} corpus  the raw spell corpus rows (get_spell_corpus)
 * @returns {{ rows: Array<Record<string, any>>, spell_ids: string[], spell_levels: Record<string, number>,
 *   uncastable: string[] }}  `uncastable` names the dropped rows by their authored id
 */
export const class_deck_of = (character, corpus) => {
  const raw_by_id = new Map((corpus ?? []).map((row) => [String(row?.id ?? ''), row]))
  const reachable = class_spells(character.class_id)
    .filter((spell) => spell.unlock_level <= character.level && raw_by_id.has(String(spell.template_id)))
    .map((spell) => ({ spell, raw: raw_by_id.get(String(spell.template_id)) }))
  const joined = reachable
    .filter(({ raw }) => cast_id_of(raw) !== '')
    .map(({ spell, raw }) => ({
      raw: { ...raw, id: cast_id_of(raw) },
      id: cast_id_of(raw),
      level: Number(character.spell_levels?.[spell.name_key] ?? 1),
    }))
  return {
    rows: joined.map(({ raw }) => raw),
    spell_ids: joined.map(({ id }) => id),
    spell_levels: Object.fromEntries(joined.map(({ id, level }) => [id, level])),
    uncastable: reachable.filter(({ raw }) => cast_id_of(raw) === '').map(({ raw }) => String(raw?.id ?? '')),
  }
}

/**
 * The whole fold. Pure over its inputs: the two live corpora arrive as lookups (the caller subscribes them),
 * and the spell corpus is read through its own module-level door — the same one every fight surface reads.
 *
 * @param {{ state: any, board: any, item_by_id: ReadonlyMap<string, any>,
 *   mob_by_id: ReadonlyMap<string, any>, mob_spells_of: (id: string) => any[] }} params
 * @returns {{ ok: true, args: object } | { ok: false, reason: string }}
 */
export const build_start_args = ({ state, board, item_by_id, mob_by_id, mob_spells_of }) => {
  const corpus = get_spell_corpus()
  const characters = new Map(state.roster.map((character) => [character.id, character]))

  // ASCENDING CELL ORDER is seat order, which IS turn order within a side (`generate_turn_order` keeps each
  // side's given order) — so the line-up a fight opens with is the one the board shows, top to bottom.
  const seated = Object.entries(state.placements)
    .map(([cell, id]) => ({ cell: Number(cell), character: characters.get(id) }))
    .filter(({ character }) => character !== undefined)
    .sort((left, right) => left.cell - right.cell)

  const picked = Object.entries(state.mob_picks)
    .map(([cell, pick]) => ({ cell: Number(cell), pick, row: mob_by_id.get(pick.template_id) }))
    .filter(({ row }) => row !== undefined)
    .sort((left, right) => left.cell - right.cell)

  if (seated.length === 0) return { ok: false, reason: START_BLOCKED.EMPTY_ROSTER }
  if (picked.length === 0) return { ok: false, reason: START_BLOCKED.NO_MOBS }

  const decks = new Map(seated.map(({ character }) => [character.id, class_deck_of(character, corpus)]))
  // NO SILENT INERT DECK (#931): a reachable class spell the fight cannot cast is dropped, never quietly, and
  // ONE line names every one of them — an armed card that folds nothing is the exact failure this fixed.
  const uncastable = [...new Set([...decks.values()].flatMap(({ uncastable: rows }) => rows))]
  if (uncastable.length > 0)
    console.error(
      `[simulator] ${uncastable.length} class spell(s) carry no on-chain SpellTemplate id and were dropped ` +
        `from the fight deck — they cannot be cast until the seed ceremony publishes their receipt: ` +
        `${uncastable.join(', ')}`
    )
  const placements = seated.map(({ cell, character }) => ({
    cell: decode(cell),
    // The spell levels the seat fights at are keyed by the CAST id here (see `cast_id_of`) — `seat_entity`
    // reads them off the character it is given, so the re-key rides on this projection.
    character: { ...character, spell_levels: decks.get(character.id).spell_levels },
    seat: build_seat(character, resolve_loadout(item_by_id, character.loadout).items),
    spell_ids: decks.get(character.id).spell_ids,
  }))

  const mobs = picked.map(({ cell, pick, row }) => ({
    cell: decode(cell),
    mob: build_mob(row, pick.level),
    spells: mob_spells_of(row.id) ?? [],
  }))

  const { team0, team1 } = build_teams({ placements, picks: mobs, class_templates: new Map() })

  return {
    ok: true,
    args: {
      seed: state.seed,
      team0,
      team1,
      // Class rows + every picked mob's authored kit, in ONE raw list — exactly what the chain normalizes and
      // the capsule records.
      templates_raw: [
        ...new Map([...decks.values()].flatMap(({ rows }) => rows).map((row) => [String(row.id), row])).values(),
        ...mobs.flatMap(({ mob, spells }) => mob_spell_rows(mob.template_id, spells)),
      ],
      roster: seated.map(({ character }) => character),
      mobs: mobs.map(({ mob }) => mob),
      focus_id: state.focus_id,
      // The fight is fought on the board the page is SHOWING: same anchor ⇒ same `board_gen` derivation, so
      // every start cell a seat stands on is the cell the sim places it into.
      anchor: { anchor_x: board.anchor.x, anchor_z: board.anchor.z },
    },
  }
}
