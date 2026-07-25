// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_setup.js — THE FIGHT-START FOLD: the setup domain (page reducer roster + L1's content
// builders) → the sim's `FightEntity` teams the authority is created from (spec §5, "Character → fight seat").
//
// The seam is deliberately narrow. L1 (`content.js`) owns every NUMBER — the max-roll equipment fold, the SDK
// health/AP/MP formulas, `scaled_hp` for mobs — and this file owns only the SHAPE change from those blocks to
// the reducer's entity rows. Nothing here computes a stat: if a value is not read off a builder's output or
// off the page reducer's character, it does not exist. That keeps one home per fact across the lane boundary,
// and it means a balance change in L1 needs no edit here.
//
// DECKS AND SPELL LEVELS. A seat's deck is its class's published spells keyed by NAME_KEY — the same key the
// page reducer's `spell_levels` uses and the same key `class_spell_templates()` maps, so a level the player
// allocated in the inspector is the level the sim casts at. Level 1 is the FREE baseline (an absent row reads
// 1 on chain), so unallocated spells still enter the deck at 1 rather than being unavailable.

import { build_mob_spell_templates, mob_spell_id } from './content.js'

/** The sim entity fields every fighter carries, whatever side it is on (`fight_state.js` FightEntity). */
const base_entity = ({ id, name, cell, hp, max_hp, ap, mp, level, stats, template_id, is_player, deck }) => ({
  id,
  name,
  cell,
  health: hp,
  health_max: max_hp,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id,
  level,
  stats,
  effects: [],
  deck,
  // The opening hand is drawn by the sim at the turn start; seeding it with the deck's head keeps a seat able
  // to act on turn one exactly as the chain's own opening draw does.
  hand: deck.slice(0, 1),
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

/**
 * One roster character + its built seat block → a player FightEntity.
 * @param {{ character: any, seat: any, spell_ids: string[], cell: {x:number,y:number} }} params
 */
export const seat_entity = ({ character, seat, spell_ids, cell }) => ({
  ...base_entity({
    id: character.id,
    name: character.name,
    cell,
    hp: seat.hp,
    max_hp: seat.max_hp,
    ap: seat.ap_max,
    mp: seat.mp_max,
    level: seat.level,
    stats: seat.stats,
    template_id: character.class_id,
    is_player: true,
    deck: spell_ids,
  }),
  // every class spell is castable; the allocated level wins, the free baseline 1 otherwise
  spell_levels: Object.fromEntries(spell_ids.map((id) => [id, Number(character.spell_levels?.[id] ?? 1)])),
})

/**
 * One picked mob + its built mob block → a mob FightEntity, plus the sim templates its authored kit needs.
 * The mob's spells are minted rows (`CorpusMobSpell`), so their templates are built here rather than read from
 * the class corpus — `content.js` owns both the id convention and the template shape.
 * @param {{ mob: any, index: number, cell: {x:number,y:number}, spells?: any[] }} params
 * @returns {{ entity: any, templates: Map<string, any> }}
 */
export const mob_entity = ({ mob, index, cell, spells = [] }) => {
  const templates = build_mob_spell_templates(mob.template_id, spells)
  const spell_ids = spells.map((_, position) => mob_spell_id(mob.template_id, position))
  return {
    entity: {
      ...base_entity({
        id: `mob_${index}`,
        name: mob.name,
        cell,
        hp: mob.hp,
        max_hp: mob.max_hp,
        ap: mob.ap,
        mp: mob.mp,
        level: mob.level,
        stats: mob.stats,
        template_id: mob.template_id,
        is_player: false,
        deck: spell_ids,
      }),
      spell_levels: Object.fromEntries(spell_ids.map((id) => [id, 1])),
    },
    templates,
  }
}

/**
 * The whole start fold: placed roster seats → team0, picked mobs → team1, and the ONE template map the
 * authority's `ctx` carries (class templates plus every mob's authored kit, merged into one map).
 *
 * `placements` and `picks` are cell-keyed exactly as the page reducer holds them, so seat order — which IS
 * turn order within a side (`generate_turn_order` keeps each side's given order) — is the deterministic
 * ascending cell order rather than object-key iteration order.
 *
 * @param {{ placements: Array<{ cell:{x:number,y:number}, character:any, seat:any, spell_ids:string[] }>,
 *          picks: Array<{ cell:{x:number,y:number}, mob:any, spells?:any[] }>,
 *          class_templates: Map<string, any> }} params
 */
export const build_teams = ({ placements, picks, class_templates }) => {
  const team0 = placements.map(({ character, seat, spell_ids, cell }) =>
    seat_entity({ character, seat, spell_ids, cell })
  )
  const mobs = picks.map(({ mob, spells, cell }, index) => mob_entity({ mob, index, cell, spells }))
  const spell_templates = new Map([...class_templates, ...mobs.flatMap(({ templates }) => [...templates])])
  return { team0, team1: mobs.map(({ entity }) => entity), spell_templates }
}
