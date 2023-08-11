import { client_chat_msg, Formats } from '../core/chat.js'

import { write_error } from './commands.js'
import { integer, literal } from './declare_options.js'

export const soul_nodes = [
  literal({
    value: 'soul',
    children: [
      integer({
        name: 'amount',
        min: 0,
        max: 100,
      }),
    ],
  }),
]

export default function soul_command({ world, sender, dispatch, args }) {
  if (args.length === 1) {
    const [soul] = args
    if (!Number.isNaN(+soul)) {
      dispatch('UPDATE_SOUL', { soul: +soul })
      client_chat_msg({
        client: sender,
        message: [
          { text: 'soul updated: ', ...Formats.BASE },
          { text: soul, ...Formats.DANGER },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
