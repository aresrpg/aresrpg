import { write_chat_msg } from '../player/chat.js'

import { literal } from './declare_options.js'

export const ragequit_nodes = [
  literal({
    value: 'ragequit',
    flags: {
      has_command: true,
    },
  }),
]

export default function ragequit({ world, sender }) {
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' a RageQuit !', color: 'red' },
      ]),
      client: sender,
    }
  )

  sender.end(
    'Ragequit',
    JSON.stringify({ text: 'ert si c trist', color: 'yellow' })
  )
}
