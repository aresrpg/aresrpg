const ADD_FUNCTIONS = [
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
]

/** Returns a proxy that intercepts newly added listeners and add them to the passed array */
export function events_interceptor(events, listener_array) {
  return new Proxy(events, {
    get: function (target, property, receiver) {
      const original_property = Reflect.get(target, property, receiver)
      if (typeof property === 'string' && ADD_FUNCTIONS.includes(property)) {
        return function (event_name, listener) {
          listener_array.push({ event_name, listener })
          return original_property.call(target, event_name, listener)
        }
      }

      return original_property
    },
  })
}
