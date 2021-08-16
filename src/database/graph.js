import Rgraph from '@hydre/rgraph'

const { USE_STORAGE = 'false' } = process.env
const GRAPH_NAME = 'aresrpg'
let handler = {
  get() {
    return () => ({})
  },
}

// not sure about this, but pretty sure delta will know what to do
if (USE_STORAGE?.toLowerCase() === 'true') {
  const { master_client } = await import('./sentinel.js')
  const graph = Rgraph(master_client)(GRAPH_NAME)
  handler = {
    get(_, prop) {
      return Reflect.get(graph, prop)
    },
  }
}

// i swear i'm going to punch your face with your damn types
// how the fuck you'd type a proxy
/** @type {any} */
export default new Proxy({}, handler)
