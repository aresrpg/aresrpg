const {
  ONLINE_MODE: online_mode = 'false',

  USE_PERSISTENT_STORAGE: use_persistent_storage = 'false',
  REDIS_HOST = '0.0.0.0',
  REDIS_SENTINEL_PORT: redis_sentinel_port = 26379,
  REDIS_MASTER_NAME = 'rejson-master',

  USE_RESSOURCE_PACK: use_ressource_pack = 'true',

  LOG_LEVEL = 'info',
  DEBUG_SERVER: debug_server = 'false',
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
export const DEBUG_SERVER = booleanify(debug_server)

<<<<<<< HEAD
export { REDIS_HOST, REDIS_MASTER_NAME, LOG_LEVEL }
=======
export const SCREENS = {
  player_screen: 'player_screen',
  clone_background: 'clone_background',
}
export { ENJIN_ENDPOINT, ENJIN_APP_SECRET, REDIS_HOST, REDIS_MASTER_NAME }

const hide = value => (value ? '<hidden>' : 'undefined')

log.info(
  {
    ONLINE_MODE,
    VERSION,
    USE_BLOCKCHAIN,
    ENJIN_ENDPOINT,
    ENJIN_APP_SECRET: hide(ENJIN_APP_SECRET),
    ENJIN_APP_ID,
    USE_PERSISTENT_STORAGE,
    REDIS_HOST,
    REDIS_SENTINEL_PORT,
    REDIS_MASTER_NAME,
  },
  'aresrpg settings'
)
>>>>>>> 10c7a08 (feat: update context & exports)
