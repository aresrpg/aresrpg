import { Position } from '../player/chat.js'

import { Types } from './types.js'

export function speak_to(mob, { client }) {
  const { dialogs, displayName } = Types[mob.mob]
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
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, world }) {
    const right_click = 2
    client.on('use_entity', ({ target, mouse, sneaking }) => {
      if (mouse === right_click && sneaking === false) {
        const mob = world.mobs.by_entity_id(target)
        if (mob) {
          speak_to(mob, { client })
        }
      }
    })
  },
}
