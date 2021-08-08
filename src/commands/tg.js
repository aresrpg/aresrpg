import { write_chat_msg } from '../player/chat.js'

import { literal } from './declare_options.js'

export const tg_nodes = [
  literal({
    value: 'tg',
    flags: {
      has_command: true,
    },
  }),
]

export default function tg({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Demande le', color: 'gold' },
        { text: ' silence', color: 'red', bold: 'true' },
        { text: ' !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
