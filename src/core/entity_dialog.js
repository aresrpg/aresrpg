import Entities from '../../data/entities.json' assert { type: 'json' }

import { Position } from './chat.js'

export function speak_to(mob, { client }) {
  const { dialogs, display_name } = Entities[mob.type]
  if (dialogs !== undefined) {
    const x = Math.floor(Math.random() * dialogs.length)
    const message = JSON.stringify([
      { text: display_name, color: 'green' },
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
