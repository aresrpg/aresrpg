import uuid from 'uuid-1345'

/**
 * @typedef State
 * @property {object} client
 */

/**
 * @typedef Option
 * @property {number} action - ADD: 0, REMOVE: 1, UPDATE_HEALTH: 2, UPDATE_TITLE: 3, UPDATE_STYLE: 4, UPDATE_FLAGS: 5
 * @property {Title} title - {text:"Exemple Title"}
 * @property {float} health - min: 0.0 , max: 1.0
 * @property {number} color - PINK: 0, BLUE: 1, RED: 2, GREEN: 3, YELLOW: 4, PURPLE: 5, WHITE: 6
 * @property {number} dividers -  NO_DIVISION: 0, '6_NOTCHES': 1, '10_NOTCHES': 2, '12_NOTCHES': 3, '20_NOTCHES': 4
 * @property {number} flags - DARKEN_SKY: 0x1, BOSS_BAR: 0x2, CREATE_FOG: 0x04
 */

/**
 * @typedef Title
 * @property {string} text - Required
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underlined]
 * @property {boolean} [strikethrough]
 * @property {boolean} [obfuscated]
 * @property {string} [color]
 * @property {array<object>} [extra]
 */

export const Actions = {
  ADD: 0,
  REMOVE: 1,
  UPDATE_HEALTH: 2,
  UPDATE_TITLE: 3,
  UPDATE_STYLE: 4,
  UPDATE_FLAGS: 5,
}
export const Colors = {
  PINK: 0,
  BLUE: 1,
  RED: 2,
  GREEN: 3,
  YELLOW: 4,
  PURPLE: 5,
  WHITE: 6,
}
export const Divisions = {
  NO_DIVISION: 0,
  '6_NOTCHES': 1,
  '10_NOTCHES': 2,
  '12_NOTCHES': 3,
  '20_NOTCHES': 4,
}
export const Flags = { DARKEN_SKY: 0x1, BOSS_BAR: 0x2, CREATE_FOG: 0x04 }

/**
 * Display Boss bar at the top of the game window.
 * Here is an example of how to use it:
 * ```js
 * options = {
 *   action: Actions.ADD,
 *   title: {
 *       text: "Exemple Title",
 *       bold: true,
 *       color: '#ffffff'
 *   },
 *   health: 1.0,
 *   color: Colors.RED,
 *   dividers: Divisions.NO_DIVISION,
 *   flags: Flags.CREATE_FOG
 * }
 * ```
 * @param {State} state,
 * @param {Option} options
 */
export function write_bossbar(
  state,
  { action, title, health, color, dividers, flags }
) {
  state.client.write('boss_bar', {
    entityUUID: uuid.v4(),
    action,
    title: title && JSON.stringify(title),
    health,
    color,
    dividers,
    flags,
  })
}
