import { client_chat_msg, Formats } from '../chat.js'
import { PlayerAction } from '../events.js'

import { write_error } from './commands.js'
import { integer, literal } from './declare_options.js'

export const health_nodes = [
  literal({
    value: 'health',
    children: [
      integer({
        name: 'amount',
        // min: 0,
        // max: 9999999,
      }),
    ],
  }),
]

export default function health_command({ world, sender, dispatch, args }) {
  if (args.length === 1) {
    const [health] = args
    if (!Number.isNaN(+health)) {
      dispatch(PlayerAction.UPDATE_HEALTH, { health: +health })
      client_chat_msg({
        client: sender,
        message: [
          { text: 'health updated: ', ...Formats.BASE },
          { text: health, ...Formats.DANGER },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
