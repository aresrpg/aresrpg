import EventEmitter from 'events'

import logger from '../logger.js'

const log = logger(import.meta)
const memory = new Map()
const emitter = new EventEmitter()

export default {
  async mint({ type, amount, wallet_address }) {
    log.info({ type, amount, wallet_address }, 'minting for a player')
    const { kares, ...state } = memory.get(wallet_address)
    memory.set(wallet_address, {
      ...state,
      kares: kares + amount,
    })
    emitter.emit(wallet_address, kares + amount)
  },

  async transfer({ item_id, from_wallet, to_wallet, amount }) {
    log.info({ item_id, from_wallet, to_wallet, amount }, 'transfering item')
  },

  // prevent a specific item from being transfered
  async freeze_item({ item_id, wallet_address }) {
    log.info({ item_id }, 'freezing NFT')
  },

  async save_state({ wallet_address, inventory, experience, kares }) {
    if (wallet_address) {
      log.info(
        { wallet_address, inventory, experience, kares },
        'saving state to solana'
      )
      memory.set(wallet_address, { inventory, experience, kares })
    }
  },

  async get_state(wallet_address) {
    if (wallet_address) return memory.get(wallet_address)
  },

  emitter,
}
