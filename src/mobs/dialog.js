import { Position } from '../chat.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { play_sound } from '../sound.js'

const RIGHT_CLICK = 2
const MAIN_HAND = 0

export function speak_to(mob, { client, position }) {
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
    if (Object.keys(sounds).length) {
      const { ambient } = sounds
      play_sound({
        client,
        sound: ambient,
        ...position,
      })
    }
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, world, get_state }) {
    client.on('use_entity', ({ target, mouse, sneaking, hand }) => {
      if (mouse === RIGHT_CLICK && sneaking === false && hand === MAIN_HAND) {
        const mob = world.mobs.by_entity_id(target)
        if (mob) {
          const { position } = get_state()
          speak_to(mob, { client, position })
        }
      }
    })
  },
}
