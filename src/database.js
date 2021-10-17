import { USE_PERSISTENT_STORAGE } from './settings.js'

export default (
  await import(
    USE_PERSISTENT_STORAGE ? './database/redis.js' : './database/memory.js'
  )
).default
