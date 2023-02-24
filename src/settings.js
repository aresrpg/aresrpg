const {
  ONLINE_MODE: online_mode = 'false',

  USE_PERSISTENT_STORAGE: use_persistent_storage = 'false',
  REDIS_HOST = '0.0.0.0',
  REDIS_SENTINEL_PORT: redis_sentinel_port = 26379,
  REDIS_MASTER_NAME = 'rejson-master',

  USE_RESOURCE_PACK: use_resource_pack = 'true',
  RESOURCE_PACK_URI = 'https://github.com/aresrpg/resourcepacks/releases/download/v1.1.0/ares-pack.zip',
  RESOURCE_PACK_HASH = 'd8a9c0bf01d0c08d88790f4d6701e96de213d5f6',

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
export const USE_RESOURCE_PACK = booleanify(use_resource_pack)
export const DEBUG_SERVER = booleanify(debug_server)

export {
  REDIS_HOST,
  REDIS_MASTER_NAME,
  LOG_LEVEL,
  RESOURCE_PACK_URI,
  RESOURCE_PACK_HASH,
}
