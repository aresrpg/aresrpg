import { on } from 'events'

import { aiter } from 'iterator-helper'
import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import Nbt from 'prismarine-nbt'

import { Context, Action } from '../events.js'
import { abortable } from '../iterator.js'
import { write_title } from '../title.js'
import { write_sound, SOUND } from '../sound.js'
import { client_chat_msg } from '../chat.js'
import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'

const mcData = minecraftData(VERSION)

const levels = [
  0, // levels starts at 1
  0,
  121,
  715,
  1650,
  3080,
  5280,
  8030,
  11550,
  15950,
  21120,
  27720,
  35860,
  45100,
  55550,
  67100,
  82500,
  100100,
  126500,
  156200,
  188100,
  222200,
  258500,
  297000,
  341000,
  388300,
  438350,
  492800,
  553300,
  617100,
  683760,
  755700,
  830500,
  911900,
  1001000,
  1100000,
  1219000,
  1358000,
  1517000,
  1696000,
  1895000,
  2114000,
  2353000,
  2612000,
  2891000,
  3190000,
  3509000,
  3848000,
  4207000,
  4586000,
  4985000,
  5404000,
  5843000,
  6302000,
  6781000,
  7280000,
  7799000,
  8338000,
  8897000,
  9476000,
  10075000,
  10694000,
  11333000,
  11992000,
  12671000,
  13370000,
  14089000,
  14828000,
  15587000,
  16366000,
  17165000,
  17984000,
  18823000,
  19682000,
  20561000,
  21460000,
  22379000,
  23318000,
  24277000,
  25256000,
  26255000,
  27274000,
  28313000,
  29372000,
  30451000,
  31550000,
  32669000,
  33808000,
  34967000,
  36146000,
  37345000,
  38564000,
  39803000,
  41062000,
  42341000,
  43640000,
  44959000,
  46298000,
  47657000,
  49036000,
  50435000,
]

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  const { next_entity_id } = world
  return {
    ...world,
    new_level_firework_entity_id: next_entity_id,
    next_entity_id: next_entity_id + 1,
  }
}

const reversed_levels = [...levels.entries()].reverse()

/**
 * find the current level and the remaining
 * experience from the total experience
 * @param {number} total_experience
 * @returns {{level: number, remaining_experience: number}}
 */
export function experience_to_level(total_experience) {
  const [current_level, current_level_experience] = reversed_levels.find(
    ([level, level_experience]) => level_experience <= total_experience
  )
  return {
    level: current_level,
    remaining_experience: total_experience - current_level_experience,
  }
}

/**
 * calculate the level progression from the
 * current level and the remaining experience
 * @param {{level: number, remaining_experience: number}} level_data
 */
export function level_progress({ level, remaining_experience }) {
  const current_level_experience = levels[level]
  if (level + 1 >= levels.length) {
    return 0
  }
  const next_level_experience = levels[level + 1]
  return (
    remaining_experience / (next_level_experience - current_level_experience)
  )
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.ADD_EXPERIENCE) {
      const { experience } = payload
      const { level: last_level } = experience_to_level(state.experience)
      const { level } = experience_to_level(state.experience + experience)
      if (level !== last_level) {
        return {
          ...state,
          soul: 100,
          experience: state.experience + experience,
        }
      } else {
        return {
          ...state,
          experience: state.experience + experience,
        }
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, world }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      (last_total_experience, [{ experience: total_experience, position }]) => {
        if (last_total_experience !== total_experience) {
          const { level, remaining_experience } =
            experience_to_level(total_experience)
          const progress = level_progress({ level, remaining_experience })

          client.write('experience', {
            totalExperience: total_experience,
            level,
            experienceBar: progress,
          })

          if (last_total_experience !== null) {
            const { level: last_level } = experience_to_level(
              last_total_experience
            )

            if (level > last_level) {
              write_title({
                client,
                title: [
                  { text: 'Niveau ', color: '#ECF0F1', italic: true },
                  {
                    text: level,
                    color: '#2ECC71',
                    bold: true,
                    italic: false,
                  },
                ],
                times: {
                  fade_in: 1,
                  stay: 4,
                  fade_out: 1.5,
                },
              })

              const message = [
                {
                  text: 'Vous venez de passer au niveau ',
                  color: '#ECF0F1',
                  italic: true,
                },
                {
                  text: level,
                  color: '#2ECC71',
                  bold: true,
                  italic: false,
                },
                { text: '\n' },
                {
                  text: 'Il vous reste ',
                  color: '#ECF0F1',
                  italic: true,
                },
                {
                  text: level * 5,
                  color: '#3498DB',
                  italic: false,
                  bold: true,
                },
                {
                  text: ' points à attribuer',
                  color: '#ECF0F1',
                  italic: true,
                },
                { text: '\n' },
                {
                  text: 'Votre âme est entièrement restorée !',
                  color: '#ECF0F1',
                  italic: true,
                },
              ]

              client_chat_msg({
                client,
                message,
              })

              write_sound({
                client,
                sound: SOUND.LEVEL_UP,
                ...position,
              })

              client.write('spawn_entity', {
                entityId: world.new_level_firework_entity_id,
                objectUUID: UUID.v4(),
                type: mcData.entitiesByName.firework_rocket.id,
                ...position,
                y: position.y + 1,
                pitch: 0,
                yaw: 0,
                velocityX: 0,
                velocityY: 0,
                velocityZ: 0,
              })

              client.write('entity_metadata', {
                entityId: world.new_level_firework_entity_id,
                metadata: to_metadata('firework_rocket_entity', {
                  firework_info: {
                    present: true,
                    itemId: mcData.itemsByName.firework_rocket.id,
                    itemCount: 1,
                    nbtData: {
                      type: 'compound',
                      name: '',
                      value: {
                        Fireworks: Nbt.comp({
                          Explosions: {
                            type: 'list',
                            value: {
                              type: 'compound',
                              value: [
                                {
                                  Type: Nbt.byte(2),
                                  Colors: {
                                    type: 'intArray',
                                    value: [0x039be5],
                                  },
                                  FadeColors: {
                                    type: 'intArray',
                                    value: [0xfdd835, 0xfdd835, 0xfdd835],
                                  },
                                  Flicker: Nbt.byte(1),
                                  Trail: Nbt.byte(1),
                                },
                                {
                                  Type: Nbt.byte(2),
                                  Colors: {
                                    type: 'intArray',
                                    value: [0xfdd835],
                                  },
                                  FadeColors: {
                                    type: 'intArray',
                                    value: [0xfdd835],
                                  },
                                  Flicker: Nbt.byte(1),
                                  Trail: Nbt.byte(1),
                                },
                              ],
                            },
                          },
                          Flight: Nbt.byte(0),
                        }),
                      },
                    },
                  },
                }),
              })

              client.write('entity_status', {
                entityId: world.new_level_firework_entity_id,
                entityStatus: 17,
              })
            } else {
              write_sound({
                client,
                sound: SOUND.EXPERIENCE_ORB,
                ...position,
              })
            }
          }
        }
        return total_experience
      },
      null
    )
  },
}
