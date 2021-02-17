import { world_chat_msg } from '../chat.js'

import { literal } from './declare_options.js'

export const respect_nodes = [
  literal({
    value: 'respect',
    flags: {
      has_command: true,
    },
  }),
]

export default function respect({ world, sender }) {
  world_chat_msg({
    world,
    message: JSON.stringify([
      { text: ' ' + sender.username, color: 'gray' },
      { text: ' cherche encore le', color: 'yellow' },
      { text: ' respect', color: 'green', bold: 'true' },
    ]),
    client: sender,
  })
}
