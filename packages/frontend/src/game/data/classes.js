// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CLASS IDENTITY ON THE RENDER SURFACES — a pure derivation, never a roster of its own.
//
// The twelve identities live in @aresrpg/sdk classes.json (the ONE roster the chain's `classe` field indexes)
// and their player-facing labels live in the i18n `simulator.classes.<ID>` maps (all six locales). This file
// derives only what a render surface asks on top of those two homes: the localized label, and the 2D sprite
// base — an ART fact (only some classes ship the Koshi2D directional sprites yet), the 2D twin of what
// character-glb.js CHARACTER_MODELS is for the 3D rigs.
//
// It used to carry a FOUR-row table of its own, so the other eight classes resolved undefined on every
// surface that asked — a lowercase `ikari` where the inventory, the drawer, the spellbook and the fight
// summary owed the player "Berserker" (#2182). Deleting the table IS the fix.

import classes_json from '@aresrpg/sdk/classes' with { type: 'json' }

/**
 * @typedef {{ id: string, name: string, title: string, sprites: string | null }} ClassIdentity
 * @typedef {(key: string, params?: object) => string} Translate
 */

/** @type {Record<string, { name: string, title: string }>} */
const ROSTER = /** @type {Record<string, { name: string, title: string }>} */ (
  /** @type {unknown} */ (classes_json)
)

// The classes shipping the reused Koshi2D 2D directional pixel sprites under public/sprites/<id>/:
// `idle/<dir>.png` (8 compass directions) + `walk/<dir>/frame_000..005.png` (the 3 west-facing directions
// are horizontal flips). test/game/data/classes.test.tsx pins this set against the directory ON DISK, so
// sprite art that lands without its row here — or a row without art — goes red.
const SPRITED_CLASSES = new Set(['senshi', 'tomoda', 'yajin', 'yogen'])

/** The sprite base a surface substitutes when a class ships none — a live world/HUD must show a body (the 2D
 *  twin of character-glb.js PLACEHOLDER_RIG_CLASS). Surfaces that seat all twelve substitute NOTHING and render
 *  the initial instead: a Senshi body on the Iyashi you are building is a lie about what the surface shows. */
export const PLACEHOLDER_SPRITES = '/sprites/senshi'

/** @param {unknown} class_id @returns {string} */
const class_key = (class_id) => String(class_id ?? '').toLowerCase()

/** The class' OWN sprite base, or null when it ships no art yet (the caller decides: placeholder or initial).
 *  @param {unknown} class_id @returns {string | null} */
export const class_sprite_base = (class_id) => {
  const id = class_key(class_id)
  return SPRITED_CLASSES.has(id) ? `/sprites/${id}` : null
}

/** The chain's `classe` field → its identity row, or null when the id names no class.
 *  @param {unknown} id @returns {ClassIdentity | null} */
export const get_class = (id) => {
  const class_id = class_key(id)
  const row = ROSTER[class_id]
  return row ? { id: class_id, name: row.name, title: row.title, sprites: class_sprite_base(class_id) } : null
}

/** The class' localized display name ("Senshi"), or null when the id names no class.
 *  @param {Translate} t @param {unknown} class_id @returns {string | null} */
export const class_display = (t, class_id) => {
  const cls = get_class(class_id)
  return cls && t(`simulator.classes.${cls.id.toUpperCase()}.display`, { defaultValue: cls.name })
}

/** The class' localized title ("Warrior"), or null when the id names no class.
 *  @param {Translate} t @param {unknown} class_id @returns {string | null} */
export const class_title = (t, class_id) => {
  const cls = get_class(class_id)
  return cls && t(`simulator.classes.${cls.id.toUpperCase()}.title`, { defaultValue: cls.title })
}
