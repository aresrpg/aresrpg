import logger from './logger.js'

const log = logger(import.meta)

const resolve_map = new Map()
const registry = new FinalizationRegistry((key) => {
  resolve_map.get(key)()
  resolve_map.delete(key)
})

function register(object) {
  const symbol = Symbol('finalization')
  registry.register(object, symbol)
  return new Promise((resolve) => resolve_map.set(symbol, resolve))
}

export default {
  observe(context) {
    const { id } = context.client
    Promise.all([
      register(context),
      ...Object.entries(context)
        .filter(([key]) => key !== 'world')
        .map(([, value]) => register(value)),
    ]).then(() => log.info({ id }, 'Client garbage collected'))
  },
}
