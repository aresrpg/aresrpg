import { write_chat_msg } from '../player/chat.js'

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
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: " S'en fout", color: 'dark_aqua' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
