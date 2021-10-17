import { EventEmitter } from 'events'

const noop = x => x
export default {
  emitter: new EventEmitter(),
  reduce: noop,
  observe: noop,
}
