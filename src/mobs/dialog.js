import { floor1 } from '../world.js'
import { Position } from '../chat.js'

import { mobs } from './mobs.js'

export default function dialog({ client }) {
  const right_click = 2
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (mouse === right_click && sneaking === false) {
      if (target in floor1.mobs) {
        const mob = floor1.mobs[target]
        speak_to(mob, { client })
      }
    }
  })
}

export function speak_to(mob, { client }) {
  const { dialogs, displayName } = mobs[mob.mob]
  if (dialogs !== undefined) {
    const x = Math.floor(Math.random() * dialogs.length)
    const message = JSON.stringify([
      { text: ' ' + displayName, color: 'green' },
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
