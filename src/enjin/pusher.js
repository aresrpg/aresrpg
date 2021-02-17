import { EventEmitter } from 'events'

import Pusher from 'pusher-js'

import { ENJIN_APP_ID } from '../settings.js'
import logger from '../logger.js'

import Queries from './graphql/index.js'

const log = logger(import.meta)

/**
 * Enjin pusher channel, they will probably not change
 * (but still let's keep fetching them just in case)
 * We keep this comment as a dev tip

 "channels": {
  "app": "enjincloud.kovan.app.{id}",
  "identity": "enjincloud.kovan.identity.{id}",
  "player": "enjincloud.kovan.app.{appId}.player.{playerId}",
  "token": "enjincloud.kovan.token.{id}",
  "user": "enjincloud.kovan.user.{id}",
  "wallet": "enjincloud.kovan.wallet.{ethAddress}"
},
 */

const Events = {
  APP_CREATED: 'EnjinCloud\\Events\\AppCreated', // app
  APP_DELETED: 'EnjinCloud\\Events\\AppDeleted', // app
  APP_LINKED: 'EnjinCloud\\Events\\AppLinked', // app, wallet
  APP_LOCKED: 'EnjinCloud\\Events\\AppLocked', // app
  APP_UNLINKED: 'EnjinCloud\\Events\\AppUnlinked', // app, wallet
  APP_UNLOCKED: 'EnjinCloud\\Events\\AppUnlocked', // app
  APP_UPDATED: 'EnjinCloud\\Events\\AppUpdated', // app
  BLOCKCHAIN_LOG_PROCESSED: 'EnjinCloud\\Events\\BlockchainLogProcessed', // app, identity, token, wallet
  IDENTITY_CREATED: 'EnjinCloud\\Events\\IdentityCreated', // app, identity, user
  IDENTITY_DELETED: 'EnjinCloud\\Events\\IdentityDeleted', // app, identity, user
  IDENTITY_LINKED: 'EnjinCloud\\Events\\IdentityLinked', // app, identity, user, wallet
  IDENTITY_UNLINKED: 'EnjinCloud\\Events\\IdentityUnlinked', // app, identity, user, wallet
  IDENTITY_UPDATED: 'EnjinCloud\\Events\\IdentityUpdated', // app, identity, user
  MESSAGE_PROCESSED: 'EnjinCloud\\Events\\MessageProcessed', // app, identity, token, wallet
  TOKEN_CREATED: 'EnjinCloud\\Events\\TokenCreated', // app, token, wallet
  TOKEN_MELTED: 'EnjinCloud\\Events\\TokenMelted', // app, token, wallet
  TOKEN_MINTED: 'EnjinCloud\\Events\\TokenMinted', // app, token, wallet
  TOKEN_TRANSFERRED: 'EnjinCloud\\Events\\TokenTransferred', // app, token, wallet
  TOKEN_UPDATED: 'EnjinCloud\\Events\\TokenUpdated', // app, token, wallet
  TRADE_COMPLETED: 'EnjinCloud\\Events\\TradeCompleted', // app, token, wallet
  TRADE_CREATED: 'EnjinCloud\\Events\\TradeCreated', // app, token, wallet
  TRANSACTION_BROADCAST: 'EnjinCloud\\Events\\TransactionBroadcast', // app, identity, token, wallet
  TRANSACTION_CANCELED: 'EnjinCloud\\Events\\TransactionCanceled', // app, identity, token, wallet
  TRANSACTION_DROPPED: 'EnjinCloud\\Events\\TransactionDropped', // app, identity, token, wallet
  TRANSACTION_EXECUTED: 'EnjinCloud\\Events\\TransactionExecuted', // app, identity, token, wallet
  TRANSACTION_FAILED: 'EnjinCloud\\Events\\TransactionFailed', // app, identity, token, wallet
  TRANSACTION_PENDING: 'EnjinCloud\\Events\\TransactionPending', // app, identity, token, wallet
  TRANSACTION_PROCESSING: 'EnjinCloud\\Events\\TransactionProcessing', // app, identity, token, wallet
  TRANSACTION_UPDATED: 'EnjinCloud\\Events\\TransactionUpdated', // app, identity, token, wallet
}

const {
  Platform: {
    notifications: {
      pusher: {
        key,
        channels: { app /* identity, token, user, wallet */ },
        options: { cluster },
      },
    },
  },
} = await Queries.pusher()

const pusher = new Pusher(key, { cluster })
const emitter = new EventEmitter()
const app_channel = pusher.subscribe(app.replace('{id}', ENJIN_APP_ID))
const events = [
  Events.TOKEN_MINTED,
  Events.TOKEN_TRANSFERRED,
  Events.IDENTITY_LINKED,
  Events.IDENTITY_UNLINKED,
]

events.forEach(event => {
  const [, , channel_name] = app_channel.name.split('.')
  const [, , event_name] = event.split('\\')
  log.info({ event: event_name, channel: channel_name }, 'listening')
  app_channel.bind(event, payload => emitter.emit('enjin', { event, payload }))
})

export { Events, emitter }
