import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { abortable } from '../iterator.js'
import { PlayerEvent } from '../events.js'
import { write_bossbar, Colors, Divisions, Actions } from '../boss_bar.js'
import logger from '../logger.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { Formats, to_hex, to_rgb } from '../chat.js'

const BOSS_BAR_AMOUNT = 3
const BOSS_BAR_TTL = 5000

const log = logger(import.meta)

// prismarine already parse UUIDs but let's stay clean
const format_uuid = entity_id =>
  `00000000-0bad-cafe-babe-${entity_id.toString().padStart(12, '0')}`

const mob_bar_color = ({ health, max_health }) => {
  const percent = (100 * health) / max_health
  if (percent > 65) return Colors.GREEN
  if (percent > 25) return Colors.YELLOW
  return Colors.RED
}

// TODO: those levels could be according to the player average damage ?
// or computed according to the floor strongest mob vs weakest
// we'll see
const mob_bar_division = ({ max_health }) => {
  if (max_health < 50) return Divisions.NOTCHES_NONE
  else if (max_health < 100) return Divisions.NOTCHES_6
  else if (max_health < 500) return Divisions.NOTCHES_10
  else if (max_health < 2000) return Divisions.NOTCHES_12
  else return Divisions.NOTCHES_20
}

const format_title = ({
  display_name,
  level,
  health,
  max_health,
  entity_id,
}) => [
  {
    text: display_name,
  },
  {
    text: ` [Lvl ${level}] `,
    color: '#C0392B', // https://materialui.co/flatuicolors #pomegranate
  },
  {
    text: '(',
  },
  {
    text: health,
    color: to_hex(to_rgb((100 * health) / max_health)),
  },
  {
    text: '/',
  },
  {
    text: max_health,
    ...Formats.SUCCESS,
  },
  {
    text: ')',
  },
]

function pad_end(array, length) {
  return [...array, ...Array.from({ length }).fill({})].slice(0, length)
}

/** @typedef {import('minecraft-protocol').Client} Client */
/** @typedef {{entityUUID: string, age: number }} BossBar */

/** @type {({ client, bossbars }: { client: Client, bossbars: BossBar[] }) => BossBar[]} */
const purge_outdated = ({ client, bossbars }) => {
  const now = Date.now()
  const is_expired = ({ age = 0 }) => age + BOSS_BAR_TTL <= now
  const is_valid = ({ age = 0 }) => age + BOSS_BAR_TTL > now

  bossbars
    .filter(is_expired)
    .filter(({ entityUUID }) => entityUUID != null)
    .forEach(({ entityUUID }) => {
      log.info({ entityUUID }, 'purge outdated bossbar')
      write_bossbar({
        client,
        entityUUID,
        action: Actions.REMOVE,
      })
    })

  return bossbars.filter(is_valid)
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    aiter(
      abortable(
        // @ts-expect-error No overload matches this call
        combineAsyncIterators(
          on(events, PlayerEvent.MOB_DAMAGED, { signal }),
          setInterval(1000, [{ timer: true }], { signal })
        )
      )
    )
      .map(([event]) => event)
      .reduce(
        (
          /** @type {BossBar[]} */
          bossbars,
          { mob, timer }
        ) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            const valid_bars = purge_outdated({ client, bossbars })
            return pad_end(valid_bars, 3)
          }

          const { get_state, type, entity_id } = mob
          const { display_name, health: max_health = 20 } = Entities[type]
          const { health, level = 1 /* the level feature is a WIP */ } =
            get_state()
          const entityUUID = format_uuid(entity_id)
          const display_health = Math.max(0, Math.min(1, health / max_health))
          const color = mob_bar_color({ health, max_health })
          const title = format_title({
            display_name,
            level,
            health,
            max_health,
            entity_id,
          })

          const { entityUUID: last_entity_uuid } =
            bossbars
              .filter(bar => !!bar)
              .find(({ entityUUID: uuid }) => uuid === entityUUID) ?? {}

          if (last_entity_uuid) {
            write_bossbar({
              client,
              entityUUID,
              action: Actions.UPDATE_HEALTH,
              health: display_health,
            })
            write_bossbar({
              client,
              entityUUID,
              action: Actions.UPDATE_STYLE,
              color,
            })
            write_bossbar({
              client,
              entityUUID,
              action: Actions.UPDATE_TITLE,
              title,
            })
            return [
              { entityUUID, age: Date.now() },
              ...bossbars.filter(({ entityUUID: uuid }) => uuid !== entityUUID),
            ]
          } else {
            log.info({ display_health, entityUUID }, 'create bossbar')
            write_bossbar({
              client,
              entityUUID,
              title,
              color,
              health: display_health,
              dividers: mob_bar_division({ max_health }),
            })

            const { entityUUID: evicted_uuid } = bossbars.at(-1)
            if (evicted_uuid) {
              write_bossbar({
                client,
                entityUUID: evicted_uuid,
                action: Actions.REMOVE,
              })
            }

            return [
              { entityUUID, age: Date.now() },
              ...bossbars
                .filter(({ entityUUID: uuid }) => uuid !== entityUUID)
                .slice(0, -1),
            ]
          }
        },
        Array.from({ length: BOSS_BAR_AMOUNT }).fill({})
      )
  },
}
