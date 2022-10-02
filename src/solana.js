import { USE_SOLANA } from './settings.js'

export default (
  await import(USE_SOLANA ? './solana/solana.js' : './solana/memory.js')
).default
