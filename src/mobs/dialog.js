import { floor1 } from '../world.js'
import { Position } from '../chat.js'

import { mobs, mobs_dialogs } from './mobs.js'

export default function detect_dialog({ client }) {
  const right_click = 2
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (mouse === right_click && sneaking === false) {
      const mob = floor1.mobs[target]
      if (mob !== undefined) {
        const mobdata = mobs_dialogs[mobs[mob.mob].displayName]
        speak_to(mobdata, { client })
      }
    }
  })
}

export function speak_to(mobdata, { client }) {
  if (mobdata !== undefined) {
    const x = Math.floor(Math.random() * mobdata.dialogs.length)
    const message = JSON.stringify({
      translate: 'chat.type.text',
      with: [
        {
          text: mobdata.name,
        },
        {
          text: mobdata.dialogs[x],
        },
      ],
    })
    const options = {
      message,
      position: Position.CHAT,
      sender: client.uuid,
    }
    const send_packet = (client) => client.write('chat', options)
    Object.values([client]).forEach(send_packet)
  }
}
