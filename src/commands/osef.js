import { world_chat_msg } from '../core/chat.js'

import { literal } from './declare_options.js'

export const osef_nodes = [
  literal({
    value: 'osef',
    flags: {
      has_command: true,
    },
  }),
]

export default function osef({ world, sender }) {
  world_chat_msg({
    world,
    message: [
      { text: ' ' + sender.username, color: 'gray' },
      { text: " S'en fout", color: 'dark_aqua' },
      { text: ' !', color: 'blue' },
    ],
    client: sender,
  })
}
