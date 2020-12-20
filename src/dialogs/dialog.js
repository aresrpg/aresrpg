import { floor1 } from '../world.js'
import { write_chat_msg } from '../chat.js'

import { default_dialog_id, mobs } from './dialogs.js'

let latest_target = default_dialog_id
let dialog_text_id = 0

export default function detect_dialog(server, { client, world }) {
  const right_click = 2
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (mouse === right_click && sneaking === false) {
      speak_to(target, server, { client, world })
    }
  })
}

export function speak_to(target, server, { client, world }) {
  // TODO:Remove Server argument in Chat.js
  const mob = floor1.mobs[target] // TODO: Replace with Client current World
  console.log(mob)
  if (mob !== undefined) {
    const mobdata = mobs[mob.mob]
    if (mobdata !== undefined) {
      if (!mobdata[target]) {
        // Default Dialog
        target = default_dialog_id
      }
      if (target !== latest_target) {
        dialog_text_id = 0
        latest_target = target
      }
      if (mobdata[target].linearity) {
        if (dialog_text_id >= mobdata[target].dialogs.length) {
          dialog_text_id = 0
        }
        write_chat_msg(
          { server },
          {
            message: JSON.stringify(
              '[' +
                (dialog_text_id + 1) +
                '/' +
                mobdata[target].dialogs.length +
                '] ' +
                mobdata[target].name +
                ': ' +
                mobdata[target].dialogs[dialog_text_id]
            ),
            client,
          }
        )
        dialog_text_id++
      } else {
        const x = Math.floor(Math.random() * mobdata[target].dialogs.length)
        write_chat_msg(
          { server },
          {
            message: JSON.stringify(
              mobdata[target].name + ': ' + mobdata[target].dialogs[x]
            ),
            client,
          }
        )
      }
    }
  }
}
