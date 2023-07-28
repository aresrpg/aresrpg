import { client_chat_msg, Formats } from '../chat.js'

import { write_error } from './commands.js'
import { integer, literal } from './declare_options.js'

const xp_args = [
  integer({
    name: 'amount',
    // min: 0,
    // max: 9999999,
  }),
]
export const xp_nodes = [
  literal({
    value: 'experience',
    children: xp_args,
  }),
  literal({
    value: 'xp',
    children: xp_args,
  }),
]

export default function experience({ sender, dispatch, args }) {
  if (args.length === 1) {
    const [experience] = args
    if (!Number.isNaN(+experience)) {
      dispatch('RECEIVE_EXPERIENCE', { experience: +experience })
      client_chat_msg({
        client: sender,
        message: [
          { text: '+', ...Formats.BASE },
          { text: experience, ...Formats.SUCCESS },
          { text: 'xp', ...Formats.BASE },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
