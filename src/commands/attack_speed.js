import { client_chat_msg, Formats } from '../chat.js'
import { PLAYER_ENTITY_ID } from '../settings.js'

import { write_error } from './commands.js'
import { double, literal } from './declare_options.js'

export const atk_nodes = [
  literal({
    value: 'attackspeed',
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
      sender.write('entity_update_attributes', {
        entityId: PLAYER_ENTITY_ID,
        properties: [
          {
            key: 'generic.max_health',
            value: 40,
            modifiers: [],
          },
          {
            key: 'generic.attack_speed',
            value: speed,
            modifiers: [],
          },
        ],
      })
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
