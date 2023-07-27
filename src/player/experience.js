import { on } from 'events'

import { aiter } from 'iterator-helper'
import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import Nbt from 'prismarine-nbt'

import { PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import { write_title } from '../title.js'
import { play_sound } from '../sound.js'
import { client_chat_msg } from '../chat.js'
import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'
import { experience_to_level } from '../experience.js'

const mcData = minecraftData(VERSION)

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  const { next_entity_id } = world
  return {
    ...world,
    new_level_firework_entity_id: next_entity_id,
    next_entity_id: next_entity_id + 1,
  }
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerEvent.RECEIVE_EXPERIENCE) {
      const { experience } = payload
      const last_level = experience_to_level(state.experience)
      const new_experience = Math.max(0, state.experience + experience)
      const level = experience_to_level(new_experience)
      if (level !== last_level) {
        return {
          ...state,
          soul: 100,
          experience: new_experience,
        }
      } else {
        return {
          ...state,
          experience: new_experience,
        }
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, world, dispatch }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal }))).reduce(
      (last_total_experience, [{ experience: total_experience, position }]) => {
        if (last_total_experience !== total_experience) {
          const level = experience_to_level(total_experience)

          if (last_total_experience !== null) {
            const last_level = experience_to_level(last_total_experience)

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
                  text: (level - 1) * 5,
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

              play_sound({
                client,
                sound: 'entity.player.levelup',
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
                          Explosions: Nbt.list(
                            Nbt.comp([
                              {
                                Type: Nbt.byte(2),
                                Colors: Nbt.intArray([0x039be5]),
                                FadeColors: Nbt.intArray([
                                  0xfdd835, 0xfdd835, 0xfdd835,
                                ]),
                                Flicker: Nbt.byte(1),
                                Trail: Nbt.byte(1),
                              },
                              {
                                Type: Nbt.byte(2),
                                Colors: Nbt.intArray([0xfdd835]),
                                FadeColors: Nbt.intArray([0xfdd835]),
                                Flicker: Nbt.byte(1),
                                Trail: Nbt.byte(1),
                              },
                            ]),
                          ),
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
              play_sound({
                client,
                sound: 'entity.experience_orb.pickup',
                ...position,
              })
            }
          }
        }
        return total_experience
      },
      null,
    )
  },
}
