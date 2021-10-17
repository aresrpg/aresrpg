import { USE_BLOCKCHAIN } from './settings.js'

export default (
  await import(USE_BLOCKCHAIN ? './enjin/enjin.js' : './enjin/enjin.offline.js')
).default
