import EventEmitter from 'events'

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import WS from 'ws'

import logger from '../logger.js'
import {
  SOLANA_MASTER_SECRET_KEY,
  SOLANA_RPC_URL,
  SOLANA_WS_URL,
} from '../settings.js'

const log = logger(import.meta)

// temporarily using web3 because @/spl-token needs it
const rpc = new Connection(SOLANA_RPC_URL)
const master_keypair = Keypair.fromSecretKey(
  bs58.decode(SOLANA_MASTER_SECRET_KEY)
)

log.info({ key: master_keypair.publicKey.toBase58() }, 'master public key')

const kares_mint = new PublicKey('F8T83ZxPqo2uJGJt8Y5achFW7WLq3ozckXh6wBz5pMyd')

// const kares_mint = await createMint(rpc, master_keypair, master_keypair.publicKey, master_keypair.publicKey, 0)
// console.log(kares_mint.toBase58())

const emitter = new EventEmitter()

log.info({ SOLANA_WS_URL }, 'connecting to solana WS')
const ws = new WS(SOLANA_WS_URL)

ws.on('error', error => log.error(error))

ws.on('open', function open() {
  log.info('Websocket openned')
  ws.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'programSubscribe',
      params: [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        {
          encoding: 'jsonParsed',
          commitment: 'finalized',
        },
      ],
    })
  )
})

ws.on('message', message => {
  try {
    const { method, ...payload } = JSON.parse(message.toString())

    if (method !== 'programNotification') return

    const {
      params: {
        result: {
          value: {
            account: { data },
          },
        },
      },
    } = payload

    // means message fell back to base64
    if (Array.isArray(data)) return

    const {
      parsed: { type, info },
    } = data

    if (type !== 'account') return

    const {
      mint,
      owner,
      tokenAmount: { amount },
    } = info

    log.info({ mint, owner, amount }, 'ws')
    emitter.emit(owner, amount)
  } catch (error) {
    log.error(error, 'unable to read WS message from solana')
  }
})

const call = ({ method, params }) =>
  fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  }).then(result => result.json())

async function get_token_account(wallet_address) {
  return getOrCreateAssociatedTokenAccount(
    rpc,
    master_keypair,
    kares_mint,
    new PublicKey(wallet_address)
  ).then(({ address }) => {
    return address
  })
}

export default {
  async mint({ type, amount, wallet_address }) {
    log.info({ type, amount, wallet_address }, 'minting for a player')
    return mintTo(
      rpc,
      master_keypair,
      kares_mint,
      await get_token_account(wallet_address),
      master_keypair.publicKey,
      amount
    )
  },

  async transfer({ item_id, from_wallet, to_wallet, amount }) {
    log.info({ item_id, from_wallet, to_wallet, amount }, 'transfering item')
  },

  // prevent a specific item from being transfered
  async freeze_item({ item_id, wallet_address }) {
    log.info(
      { item_id, token_account: await get_token_account(wallet_address) },
      'freezing NFT'
    )
  },

  async save_state({ wallet_address, inventory, experience, kares }) {
    if (wallet_address) {
      log.info(
        { wallet_address, inventory, experience, kares },
        'saving state to solana'
      )
    }
  },

  // supposed to return a json object which can be merged in the state
  async get_state(wallet_address) {
    if (wallet_address) {
      const token_account = await get_token_account(wallet_address)
      const {
        result: {
          value: { amount },
        },
      } = await call({
        method: 'getTokenAccountBalance',
        params: [token_account.toBase58()],
      })
      return {
        experience: 1000,
        inventory: Array.from({ length: 46 }),
        kares: amount,
      }
    }
  },

  emitter,
}
