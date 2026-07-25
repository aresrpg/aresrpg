// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/board_paint.ts — setup state → what the board should SHOW. Pure.
//
// The engine owns pixels, the dapp owns truth (the tactical board's own contract): this fold is the dapp
// half — the two start bands, the seat glow under every occupied cell, and one entity spec per fighter. The
// mount (simulator/mount.js) does nothing but hand the result to the board handle, which is why the whole
// decision surface is testable with no engine, no canvas and no GLB on disk.
//
// MODEL RESOLUTION, and why it differs from the live game's: `voxel_fight_folds.glb_variant_of` substitutes
// the Senshi rig for a class that ships none, because the live board must show a body. The simulator seats
// ALL TWELVE classes on purpose, so a substitution would put a Senshi body on the Iyashi you are building —
// a lie about the very thing the page exists to show. Here an unrigged class resolves NO url, and the
// engine's S4 capsule stands in: honest, and visibly "no art yet". Mobs keep the production resolver (its
// own miss path is already loud).

import { decode } from '@aresrpg/fight/los'

import { CHARACTER_MODELS, character_glb_url, has_character_model } from '../game/screens/character-glb.js'
import { get_mob_model } from '../game/data/mobs.js'

import type { SimBoard, SimCell } from './board'
import type { SimCharacter, SimMobPicks, SimPlacements } from './reducer'

export type SetupFighter = {
  id: string
  kind: 'player' | 'mob'
  cell: SimCell
  /** absent ⇒ the engine's S4 capsule placeholder stands in */
  glb_variant?: string
  hair_url?: string
  colors?: unknown
}

export type SetupScene = {
  /** ally band — where roster characters may be placed (painted blue) */
  start_a: SimCell[]
  /** enemy band — where mobs may be picked (painted red) */
  start_b: SimCell[]
  ally_seats: SimCell[]
  enemy_seats: SimCell[]
  fighters: SetupFighter[]
}

/** What a click on a board cell MEANS in setup — the one place the two bands' verbs are decided. */
export type CellIntent =
  | { type: 'mob_cell'; cell: number }
  | { type: 'place'; cell: number; id: string }
  | { type: 'unplace'; cell: number }
  | null

/**
 * Read a raw cell click. The enemy band always opens the mob picker (for that seat, occupied or not); the
 * ally band seats the FOCUSED character, and clicking the cell that already holds it lifts it back off.
 * A click anywhere else — an obstacle, a mid-board cell, the void — is not an interaction at all.
 */
export const cell_intent_of = (
  board: Readonly<SimBoard>,
  setup: Readonly<{ placements: SimPlacements; focus_id: string | null }>,
  cell: number
): CellIntent => {
  if (board.start_cells_b.includes(cell)) return { type: 'mob_cell', cell }
  if (!board.start_cells_a.includes(cell)) return null
  if (setup.placements[cell] !== undefined && setup.placements[cell] === setup.focus_id)
    return { type: 'unplace', cell }
  return setup.focus_id ? { type: 'place', cell, id: setup.focus_id } : null
}

/** The class body GLB for a character, or undefined when this class ships no rig (⇒ S4 capsule). */
export const class_body_url = (class_id: string, male: boolean): string | undefined => {
  const rig = String(class_id ?? '').toLowerCase()
  if (!has_character_model(rig)) return undefined
  return character_glb_url(CHARACTER_MODELS[rig]?.[male ? 'male' : 'female']?.body) ?? undefined
}

/** The class hair mesh, or undefined (a bald row is bald, never broken). */
export const class_hair_url = (class_id: string, male: boolean): string | undefined => {
  const rig = String(class_id ?? '').toLowerCase()
  if (!has_character_model(rig)) return undefined
  return character_glb_url(CHARACTER_MODELS[rig]?.[male ? 'male' : 'female']?.hair) ?? undefined
}

/**
 * Fold the setup state into everything the viewport paints.
 * @param board the derived board (simulator/board.ts)
 * @param setup the reducer's roster + placements + mob picks, and the corpus name lookup mobs render by
 */
export const setup_scene_of = (
  board: Readonly<SimBoard>,
  setup: Readonly<{
    roster: readonly SimCharacter[]
    placements: SimPlacements
    mob_picks: SimMobPicks
    mob_name_of: (template_id: string) => string
  }>
): SetupScene => {
  const characters = new Map(setup.roster.map((character) => [character.id, character]))
  const placed = Object.entries(setup.placements)
    .map(([cell, id]) => ({ cell: Number(cell), character: characters.get(id) }))
    .filter((row): row is { cell: number; character: SimCharacter } => row.character !== undefined)
  const mobs = Object.entries(setup.mob_picks).map(([cell, pick]) => ({ cell: Number(cell), pick }))

  return {
    start_a: board.start_cells_a.map((cell) => decode(cell)),
    start_b: board.start_cells_b.map((cell) => decode(cell)),
    ally_seats: placed.map(({ cell }) => decode(cell)),
    enemy_seats: mobs.map(({ cell }) => decode(cell)),
    fighters: [
      ...placed.map(({ cell, character }) => ({
        id: character.id,
        kind: 'player' as const,
        cell: decode(cell),
        glb_variant: class_body_url(character.class_id, character.male),
        hair_url: class_hair_url(character.class_id, character.male),
        colors: null,
      })),
      // A mob's board id is its CELL, not its template: the same template can be seated twice, and a seat
      // is what the player actually moved.
      ...mobs.map(({ cell, pick }) => ({
        id: `sim_mob_${cell}`,
        kind: 'mob' as const,
        cell: decode(cell),
        glb_variant: get_mob_model({ variant: pick.template_id, name: setup.mob_name_of(pick.template_id) }).url,
      })),
    ],
  }
}
