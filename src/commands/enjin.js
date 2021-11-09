import { client_chat_msg, Formats } from '../chat.js'
import { USE_BLOCKCHAIN } from '../settings.js'

import {
  literal,
  integer,
  entity,
  ParserProperties,
} from './declare_options.js'
import { write_error } from './commands.js'

export const nodes = [
  literal({
    value: 'enjin',
    children: [
      literal({
        value: 'send',
        children: [
          entity({
            name: 'target player',
            properties: ParserProperties.entity.PLAYER,
            children: [
              integer({
                name: 'kAres amount',
              }),
            ],
          }),
        ],
      }),
      literal({
        value: 'kares',
      }),
      literal({
        value: 'link',
      }),
    ],
  }),
]

const Handlers = {
  kares({ state: { kares }, sender }) {
    client_chat_msg({
      message: [
        { text: `kAres:`, ...Formats.BASE },
        { text: ` ${kares}`, color: 'gold', bold: true },
      ],
      client: sender,
    })
  },
  link({ state, sender }) {
    const {
      enjin: { wallet_linking_code, wallet_address },
    } = state
    if (!wallet_linking_code) {
      client_chat_msg({
        message: [
          {
            text: 'Your wallet is already linked to the address ',
            ...Formats.BASE,
          },
          {
            text: wallet_address,
            ...Formats.INFO,
          },
          {
            text: ', you can unlink it in your Enjin wallet',
            ...Formats.BASE,
          },
        ],
        client: sender,
      })
    } else {
      client_chat_msg({
        message: [
          {
            text: 'Here is your Enjin wallet linking code: ',
            ...Formats.BASE,
          },
          {
            text: wallet_linking_code,
            ...Formats.INFO,
          },
        ],
        client: sender,
      })
    }
  },
}
export default function enjin({ args, world, sender, get_state }) {
  const [type] = args
  const state = get_state()
  const handler = Handlers[type?.toLowerCase()]
  if (!USE_BLOCKCHAIN) {
    client_chat_msg({
      message: {
        text: 'Enjin is not enabled on this server',
        ...Formats.DANGER,
      },
      client: sender,
    })
  } else if (handler) handler({ args, world, sender, state })
  else write_error({ sender })
}
