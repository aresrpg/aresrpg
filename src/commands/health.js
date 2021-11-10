import { client_chat_msg } from '../chat.js'
import { Action } from '../events.js'

import { write_error } from './commands.js'
import { integer, literal } from './declare_options.js'

export const nodes = [
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

export default function health({ world, sender, dispatch, args }) {
  if (args.length === 1) {
    const [health] = args
    if (!Number.isNaN(+health)) {
      dispatch(Action.HEALTH, { health: +health })
      client_chat_msg({
        client: sender,
        message: [
          { text: 'health updated: ', color: '#ECF0F1', italic: true },
          { text: health, color: '#E74C3C', bold: true, italic: false },
        ],
      })
      return
    }
  }
  write_error({ sender })
}
