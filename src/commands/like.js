import { world_chat_msg } from '../chat.js'

import { literal } from './declare_options.js'

export const like_nodes = [
  literal({
    value: 'like',
    flags: {
      has_command: true,
    },
    children: [],
  }),
]

export default function like({ world, sender }) {
  world_chat_msg({
    world,
    message: [
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' Aime ça', color: 'dark_aqua' },
      { text: ' !', color: 'blue' },
    ],
    client: sender,
  })
}
