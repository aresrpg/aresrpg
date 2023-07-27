import { send_attack_speed } from '../attribute.js'
import { client_chat_msg, Formats } from '../chat.js'

import { write_error } from './commands.js'
import { double, literal } from './declare_options.js'

export const atk_nodes = [
  literal({
    value: 'attack_speed',
    children: [
      double({
        name: 'amount',
        // min: 0,
        // max: 1024,
      }),
    ],
  }),
]

export default function attack_speed({ sender, dispatch, args }) {
  if (args.length === 1) {
    const [speed] = args
    if (!Number.isNaN(+speed)) {
      send_attack_speed(sender, +speed)
      client_chat_msg({
        client: sender,
        message: [
          { text: 'generic.attack_speed updated: ', ...Formats.BASE },
          { text: speed, ...Formats.SUCCESS },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
