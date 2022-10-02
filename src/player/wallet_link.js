import { on } from 'events'

import { aiter } from 'iterator-helper'

import { client_chat_msg, Formats } from '../chat.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'
import Solana from '../solana.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch }) {
    const solana_handler = kares => {
      log.info({ kares }, 'dispatch BLOCKCHAIN_SYNC')
      dispatch(Action.BLOCKCHAIN_SYNC, kares)
    }

    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ wallet_address }]) => wallet_address)
      .reduce((last_wallet_address, wallet_address) => {
        if (last_wallet_address !== wallet_address) {
          if (last_wallet_address !== null) {
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

          Solana.emitter.off(last_wallet_address, solana_handler)
          Solana.emitter.on(wallet_address, solana_handler)
        }
        return wallet_address
      }, null)
  },
}
