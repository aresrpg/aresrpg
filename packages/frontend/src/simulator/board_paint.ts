// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/board_paint.ts — setup state → what the board should SHOW. Pure.
//
// The engine owns pixels, the dapp owns truth (the tactical board's own contract): this fold is the dapp
// half — the two start bands, the seat glow under every occupied cell, and one entity spec per fighter. The
// mount (simulator/mount.js) does nothing but hand the result to the board handle, which is why the whole
// decision surface is testable with no engine, no canvas and no GLB on disk.
//
// MODEL RESOLUTION is the GENERIC one — `character_model_urls` (game/screens/character-glb.js), the same door
// the roam avatar, remote players and the world fight board resolve through. The only thing this surface says
// differently is its `fallback` ARGUMENT: the live board substitutes the Senshi rig for a class that ships
// none because a board must show a body, while the simulator seats ALL TWELVE classes on purpose — a
// substitution would put a Senshi body on the Iyashi you are building, a lie about the very thing the page
// exists to show. So an unrigged class resolves NO url here and the engine's S4 capsule stands in: honest,
// and visibly "no art yet". One rule, one home, one explicit policy argument. Mobs keep the production
// resolver (its own miss path is already loud).

import { decode } from '@aresrpg/fight/los'

import { character_model_urls } from '../game/screens/character-glb.js'
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
  { type: 'mob_cell'; cell: number } | { type: 'ally_cell'; cell: number } | { type: 'unplace'; cell: number } | null

/**
 * Read a raw cell click. BOTH bands answer the same two verbs, which is why there is no branch per band
 * beyond naming the seat: an EMPTY start cell opens its picker at that cell, an OCCUPIED one empties it.
 * A click anywhere else — an obstacle, a mid-board cell, the void — is not an interaction at all.
 *
 * Placement used to read a FOCUSED roster row, so seating a character was a two-panel dance (select left,
 * click middle) and an unfocused click did nothing at all. The cell is the whole gesture now: the board is
 * the only door onto who stands where, and the panels beside it are a roster and a read-out.
 */
export const cell_intent_of = (
  board: Readonly<SimBoard>,
  setup: Readonly<{ placements: SimPlacements }>,
  cell: number
): CellIntent => {
  if (board.start_cells_b.includes(cell)) return { type: 'mob_cell', cell }
  if (!board.start_cells_a.includes(cell)) return null
  return setup.placements[cell] === undefined ? { type: 'ally_cell', cell } : { type: 'unplace', cell }
}

/** The shared rig resolver with THIS surface's policy: no placeholder substitution (see the header). The
 *  page stores class ids as authored, so the lookup is case-folded here — a decode, not a second rule. */
const rig_urls_of = (class_id: string, male: boolean) =>
  character_model_urls(String(class_id ?? '').toLowerCase(), male)

/** The class body GLB for a character, or undefined when this class ships no rig (⇒ S4 capsule). */
export const class_body_url = (class_id: string, male: boolean): string | undefined => rig_urls_of(class_id, male).body

/** The class hair mesh, or undefined (a bald row is bald, never broken). */
export const class_hair_url = (class_id: string, male: boolean): string | undefined => rig_urls_of(class_id, male).hair

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
        glb_variant:
          get_mob_model({ variant: pick.template_id, name: setup.mob_name_of(pick.template_id) }).url ?? undefined,
      })),
    ],
  }
}
