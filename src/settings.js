import logger from './logger.js'

const log = logger(import.meta)
const {
  ONLINE_MODE: online_mode = 'false',
  USE_PERSISTENT_STORAGE: use_persistent_storage = 'false',
  USE_RESSOURCE_PACK: use_ressource_pack = 'true',
  REDIS_HOST = '0.0.0.0',
  USE_SOLANA: use_solana = 'false',
  SOLANA_MASTER_SECRET_KEY,
  SOLANA_RPC_URL = 'http://0.0.0.0:8899',
} = process.env

const booleanify = variable => variable?.toLowerCase() === 'true'

export const VERSION = '1.16.5'
export const ONLINE_MODE = booleanify(online_mode)
export const PLAYER_ENTITY_ID = 0
export const PLAYER_INVENTORY_ID = 0
export const SERVER_UUID = '00000000000000000000000000000000'
export const USE_RESSOURCE_PACK = booleanify(use_ressource_pack)
export const USE_PERSISTENT_STORAGE = booleanify(use_persistent_storage)
export const USE_SOLANA = booleanify(use_solana)

export { REDIS_HOST, SOLANA_RPC_URL, SOLANA_MASTER_SECRET_KEY }

const hide = value => (value ? '<hidden>' : 'undefined')

log.info(
  {
    ONLINE_MODE,
    VERSION,
    USE_PERSISTENT_STORAGE,
    USE_RESSOURCE_PACK,
    REDIS_HOST,
    SOLANA_MASTER_SECRET_KEY: hide(SOLANA_MASTER_SECRET_KEY),
    SOLANA_RPC_URL,
  },
  'aresrpg settings'
)
