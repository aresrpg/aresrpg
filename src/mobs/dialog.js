import { Position } from '../chat.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { play_sound } from '../sound.js'

export function speak_to(mob, { client, get_state }) {
  const { dialogs, displayName, sounds } = Entities[mob.type]
  if (dialogs !== undefined) {
    const x = Math.floor(Math.random() * dialogs.length)
    const message = JSON.stringify([
      { text: displayName, color: 'green' },
      { text: ' : ', color: 'gray' },
      {
        text: dialogs[x].replace('{player}', client.username),
        color: 'white',
      },
    ])
    client.write('chat', {
      message,
      position: Position.CHAT,
      sender: client.uuid,
    })
    const { ambient } = sounds
    play_sound({
      client,
      sound: ambient,
      ...get_state().position,
    })
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, world, get_state }) {
    const right_click = 2
    const main_hand = 0
    client.on('use_entity', ({ target, mouse, sneaking, hand }) => {
      if (mouse === right_click && sneaking === false && hand === main_hand) {
        const mob = world.mobs.by_entity_id(target)
        if (mob) {
          speak_to(mob, { client, get_state })
        }
      }
    })
  },
}
