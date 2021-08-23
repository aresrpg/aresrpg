import { use_persistent_storage } from './settings.js'
import logger from './logger.js'

const log = logger(import.meta)

log.info({ use_persistent_storage }, 'Initializing storage')

export default (
  await import(
    use_persistent_storage ? './database/redis.js' : './database/memory.js'
  )
).default
