import { send_movement_speed } from '../core/attribute.js'
import { client_chat_msg, Formats } from '../core/chat.js'

import { write_error } from './commands.js'
import { double, literal } from './declare_options.js'

export const speed_nodes = [
  literal({
    value: 'speed',
    children: [
      double({
        name: 'amount',
        // min: 0,
        // max: 1024,
      }),
    ],
  }),
]

export default function speed({ sender, dispatch, args }) {
  if (args.length === 1) {
    const [speed] = args
    if (!Number.isNaN(+speed)) {
      send_movement_speed(sender, +speed)
      client_chat_msg({
        client: sender,
        message: [
          { text: 'generic.movement_speed updated: ', ...Formats.BASE },
          { text: speed, ...Formats.SUCCESS },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
