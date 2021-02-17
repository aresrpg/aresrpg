import { world_chat_msg } from '../chat.js'

import { literal } from './declare_options.js'

export const dislike_nodes = [
  literal({
    value: 'dislike',
    flags: {
      has_command: true,
    },
  }),
]

export default function dislike({ world, sender }) {
  world_chat_msg({
    world,
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' a', color: 'blue' },
      { text: ' Dislike', color: 'red' },
      { text: ' !', color: 'blue' },
    ]),
    client: sender,
  })
}
