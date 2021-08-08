import { write_chat_msg } from '../player/chat.js'

import { literal } from './declare_options.js'

export const fragile_nodes = [
  literal({
    value: 'f',
    flags: {
      has_command: true,
    },
  }),
]

export default function fragile({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: " trouve qu'il y a trop de", color: 'yellow' },
        { text: ' fragile', color: 'blue', bold: 'true' },
        { text: ' ici', color: 'yellow' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
