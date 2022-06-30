import logger from '../logger.js'
import { ENJIN_APP_ID } from '../settings.js'
import { client_chat_msg, Formats } from '../chat.js'
import { Action, Context } from '../events.js'

import { Events, emitter } from './pusher.js'
import Queries from './graphql/index.js'
import Items from './kovan.json' assert { type: 'json' }

const log = logger(import.meta)
const tap = consume => payload => {
  consume(payload)
  return payload
}

const get_identity = uuid =>
  Queries.get_identity({ uuid }).then(
    ({ EnjinUser: { identities } }) => identities[0]
  )

const create_player = uuid =>
  Queries.create_player({ uuid }).then(
    ({ CreateEnjinUser: { identities } }) => identities[0]
  )

function get_or_create_identity({ uuid, username }) {
  return get_identity(uuid)
    .then(tap(() => log.info({ username }, 'Enjin identity initialized')))
    .catch(error => {
      // we only log the errors we do not expect
      // otherwise it's fine to ignore
      if (error['0'].message !== 'No record was found.') log.error(error)
      return create_player(uuid)
        .then(tap(() => log.info({ username }, 'new Enjin identity created')))
        .catch(error => {
          log.error(
            {
              username,
              error,
            },
            'unable to get the Enjin identity'
          )
          return {}
        })
    })
}

export default {
  emitter,

  reduce(state, { type, payload }) {
    switch (type) {
      case Action.ENJIN:
        return {
          ...state,
          enjin: {
            ...state.enjin,
            ...payload,
          },
        }
    }

    return state
  },

  /** @type {import('../context.js').Observer} */
  async observe({ events, dispatch, client, signal, get_state }) {
    const blockchain_subscribe = ({ event, payload }) =>
      events.emit(event, payload)
    // @ts-ignore
    client.once('end', () => emitter.off('enjin', blockchain_subscribe))
    emitter.on('enjin', blockchain_subscribe)

    async function initialize() {
      // here we could check the state to know if the player is linked
      // but the single source of truth is the blockchain and not our DB
      const { linkingCode, id } = await get_or_create_identity(client)

      if (linkingCode) {
        // the user doesn't have an ETH wallet
        dispatch(Action.ENJIN, {
          identity_id: id,
          wallet_linking_code: linkingCode,
          wallet_linked: false,
          wallet_address: undefined,
        })
      } else {
        // the user has an ETH wallet
        // his inventory was loaded through the database
        // but we're going to override it by loading from the blockchain
        const {
          EnjinIdentity: {
            wallet: { balances, ethAddress },
          },
        } = await Queries.get_player_infos({
          identity_id: id,
          appId: ENJIN_APP_ID,
        })
        const items = balances
          .map(({ value, token }) => ({
            ...token,
            amount: value,
          }))
          .filter(({ id }) => id !== Items.KARES)
        const { value: kares } = balances.find(
          ({ token }) => token.id === Items.KARES
        ) ?? { value: 0 }
        dispatch(Action.ENJIN, {
          kares,
          items,
          identity_id: id,
          wallet_linking_code: undefined,
          wallet_linked: true,
          wallet_address: ethAddress,
        })
      }
    }

    events.once(Context.STATE, state => {
      initialize().catch(error => {
        log.error(
          error,
          'something went wrong while initializing the player with enjin'
        )
      })
    })

    events.on(Events.IDENTITY_LINKED, payload => {
      const {
        enjin: { identity_id },
      } = get_state()
      const {
        identity: { id },
        wallet: { ethAddress: wallet_address },
      } = payload
      if (id === identity_id) {
        log.info({ username: client.username }, 'identity linked')
        client_chat_msg({
          client,
          message: [
            {
              text: `Your Enjin identity was linked to your wallet `,
              ...Formats.BASE,
            },
            { text: '✓', ...Formats.SUCCESS },
          ],
        })
        dispatch(Action.ENJIN, {
          wallet_linking_code: undefined,
          wallet_linked: true,
          wallet_address,
        })
      }
    })

    events.on(Events.IDENTITY_UNLINKED, payload => {
      const {
        enjin: { identity_id },
      } = get_state()
      const {
        identity: { id },
      } = payload
      if (id === identity_id) {
        get_identity(client.uuid)
          .then(identity => {
            log.info({ username: client.username }, 'identity unlinked')
            client_chat_msg({
              client,
              message: [
                {
                  text: `Your Enjin identity was unlinked `,
                  ...Formats.BASE,
                },
                { text: '⚠', ...Formats.WARN },
              ],
            })
            dispatch(Action.ENJIN, {
              wallet_linking_code: identity.linkingCode,
              wallet_linked: false,
              wallet_address: undefined,
            })
          })
          .catch(error => {
            log.error(
              error,
              `unable to find the Enjin identity for ${client.username}`
            )
            dispatch(Action.ENJIN, {
              wallet_linking_code: '... error :(',
              wallet_linked: false,
              wallet_address: undefined,
            })
          })
      }
    })
  },
}
