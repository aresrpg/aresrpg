import { world_chat_msg } from '../core/chat.js'

import { literal } from './declare_options.js'

export const thug_nodes = [
  literal({
    value: 'thug',
    flags: {
      has_command: true,
    },
  }),
]

export default function thug({ world, sender }) {
  world_chat_msg({
    world,
    message: [
      { text: ' ' + sender.username, color: 'gray' },
      { text: " Pense qu'il y a un", color: 'blue' },
      { text: ' Gangster', color: 'red' },
      { text: ' Parmis nous !', color: 'blue' },
    ],
    client: sender,
  })
}
