import { write_chat_msg } from '../player/chat.js'

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
  write_chat_msg(
    { world },
    {
      message: JSON.stringify([
        { text: ' ' + sender.username, color: 'gray' },
        { text: ' Harry Golay !', color: 'blue' },
      ]),
      client: sender,
    }
  )
}
