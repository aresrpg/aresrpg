import uuid from 'uuid-1345'

/**
 * @typedef State
 * @property {object} client
 */

/**
 * @typedef Option
 * @property {client} client - the client
 * @property {any} entityUUID - the entity_id
 * @property {any} title - chat component
 * @property {number} health - min: 0.0 , max: 1.0
 * @property {number} action - the Action
 * @property {number} color - the Color
 * @property {number} dividers -  Divide the bar into multiple chunks
 * @property {number} flags - DARKEN_SKY, BOSS_BAR, CREATE_FOG
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
  NOTCHES_NONE: 0,
  NOTCHES_6: 1,
  NOTCHES_10: 2,
  NOTCHES_12: 3,
  NOTCHES_20: 4,
}

export const Flags = { DARKEN_SKY: 0x1, BOSS_BAR: 0x2, CREATE_FOG: 0x04 }

/** @type {(options: any) => any} */
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
 */
export const write_bossbar = ({
  client,
  entityUUID = uuid.v4(),
  title = { text: '' },
  health = 1,
  action = Actions.ADD,
  color = Colors.GREEN,
  dividers, // we don't want a default divider as the color update should be made alone
  flags = Flags.BOSS_BAR,
}) =>
  client.write('boss_bar', {
    entityUUID,
    action,
    title: JSON.stringify(title),
    health: Math.round(health * 100) / 100,
    color,
    ...(dividers && { dividers }),
    flags,
  })
