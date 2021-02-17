import { client_chat_msg } from '../chat.js'
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
        { text: `kAres:`, color: 'gray', underline: true },
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
            color: '#ECF0F1',
            italic: true,
          },
          {
            text: wallet_address,
            italic: false,
            bold: true,
            color: '#9C27B0',
          },
          {
            text: ', you can unlink it in your Enjin wallet',
            color: '#ECF0F1',
            italic: true,
            bold: false,
          },
        ],
        client: sender,
      })
    } else {
      client_chat_msg({
        message: [
          {
            text: 'Here is your Enjin wallet linking code: ',
            color: '#ECF0F1',
            italic: true,
          },
          {
            text: wallet_linking_code,
            color: '#3498DB',
            italic: false,
            bold: true,
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
        color: '#E74C3C',
        bold: true,
      },
      client: sender,
    })
  } else if (handler) handler({ args, world, sender, state })
  else write_error({ sender })
}
