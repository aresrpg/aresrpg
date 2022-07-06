import { on } from 'events'

import { aiter } from 'iterator-helper'

import { client_chat_msg, Formats } from '../chat.js'
import { Context } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch }) {
    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ wallet_address }]) => wallet_address)
      .reduce((last_wallet_address, wallet_address) => {
        if (
          last_wallet_address !== null &&
          last_wallet_address !== wallet_address
        ) {
          const shrinked = `${wallet_address.slice(
            0,
            5
          )}...${wallet_address.slice(-5)}`
          client_chat_msg({
            client,
            message: [
              {
                text: 'New Wallet linked: ',
                ...Formats.BASE,
              },
              { text: shrinked, ...Formats.INFO },
            ],
          })
        }
        return wallet_address
      }, null)
  },
}
