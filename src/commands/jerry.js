import { world_chat_msg } from '../core/chat.js'

import { literal } from './declare_options.js'

export const jerry_nodes = [
  literal({
    value: 'jerry',
    flags: {
      has_command: true,
    },
  }),
]

export default function jerry({ world, sender }) {
  world_chat_msg({
    world,
    message: [
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' Harry Golay !', color: 'blue' },
    ],
    client: sender,
  })
}
