import logger from './logger.js'

const log = logger(import.meta)
const {
  ONLINE_MODE: online_mode = 'false',

  USE_PERSISTENT_STORAGE: use_persistent_storage = 'false',
  REDIS_HOST = '0.0.0.0',
  REDIS_SENTINEL_PORT: redis_sentinel_port = 26379,
  REDIS_MASTER_NAME = 'rejson-master',

  USE_RESSOURCE_PACK: use_ressource_pack = 'true',
} = process.env

const booleanify = variable => variable?.toLowerCase() === 'true'

export const VERSION = '1.16.5'
export const ONLINE_MODE = booleanify(online_mode)
export const USE_PERSISTENT_STORAGE = booleanify(use_persistent_storage)
export const REDIS_SENTINEL_PORT = +redis_sentinel_port
export const PLAYER_ENTITY_ID = 0
export const PLAYER_INVENTORY_ID = 0
export const SERVER_UUID = '00000000000000000000000000000000'
export const USE_RESSOURCE_PACK = booleanify(use_ressource_pack)

export { REDIS_HOST, REDIS_MASTER_NAME }

log.info(
  {
    ONLINE_MODE,
    VERSION,
    USE_PERSISTENT_STORAGE,
    REDIS_HOST,
    REDIS_SENTINEL_PORT,
    REDIS_MASTER_NAME,
  },
  'aresrpg settings'
)
