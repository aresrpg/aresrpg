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
// the corpus' own, keyed by their authored `id`; the deck ids and the invested spell levels are re-keyed onto
// that same id space, because the page persists spell levels by `name_key` (stable across republishes) while
// the chain templates key by object id. One translation, one place.

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
 * The castable rows for one character: its class' spells whose unlock level it has reached, joined to the RAW
 * corpus row each one normalizes from. A row the corpus no longer carries is dropped — the deck must never
 * name a template the chain's ctx cannot resolve.
 * @param {{ class_id: string, level: number, spell_levels?: Record<string, number> }} character
 * @param {Array<Record<string, any>>} corpus  the raw spell corpus rows (get_spell_corpus)
 * @returns {{ rows: Array<Record<string, any>>, spell_ids: string[], spell_levels: Record<string, number> }}
 */
export const class_deck_of = (character, corpus) => {
  const raw_by_id = new Map((corpus ?? []).map((row) => [String(row?.id ?? ''), row]))
  const joined = class_spells(character.class_id)
    .filter((spell) => spell.unlock_level <= character.level && raw_by_id.has(String(spell.template_id)))
    .map((spell) => ({
      raw: raw_by_id.get(String(spell.template_id)),
      id: String(spell.template_id),
      level: Number(character.spell_levels?.[spell.name_key] ?? 1),
    }))
  return {
    rows: joined.map(({ raw }) => raw),
    spell_ids: joined.map(({ id }) => id),
    spell_levels: Object.fromEntries(joined.map(({ id, level }) => [id, level])),
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
  const placements = seated.map(({ cell, character }) => ({
    cell: decode(cell),
    // The spell levels the seat fights at are keyed by TEMPLATE id here (see the header) — `seat_entity`
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
