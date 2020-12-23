import { floor1 } from '../world.js'
import { Position } from '../chat.js'

import { mobs } from './mobs.js'

export default function dialog({ client }) {
  const right_click = 2
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (mouse === right_click && sneaking === false) {
      if (target in floor1.mobs) {
        const mob = floor1.mobs[target] // FIXME: check proper entity id here
        speak_to(mob, { client })
      }
    }
  })
}

export function speak_to(mob, { client }) {
  if (mobs[mob.mob].dialogs !== undefined) {
    const x = Math.floor(Math.random() * mobs[mob.mob].dialogs.length)
    const message = JSON.stringify([
      { text: ' ' + mobs[mob.mob].displayName, color: 'green' },
      { text: ' : ', color: 'gray' },
      {
        text: mobs[mob.mob].dialogs[x].replace('{player}', client.username),
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
