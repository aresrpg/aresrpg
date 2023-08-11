const ADD_FUNCTIONS = [
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
]

export function events_interceptor(emitter) {
  let listener_array = []

  return new Proxy(emitter, {
    get: function (target, property, receiver) {
      const original_property = Reflect.get(target, property, receiver)

      if (typeof property === 'string' && ADD_FUNCTIONS.includes(property)) {
        return function (event_name, listener) {
          listener_array.push({ event_name, listener })
          return original_property.call(target, event_name, listener)
        }
      }

      if (property === 'remove_all_intercepted_listeners') {
        return function () {
          listener_array.forEach(({ event_name, listener }) =>
            target.removeListener(event_name, listener),
          )
          listener_array = [] // Reset the array
        }
      }

      return original_property
    },
  })
}
