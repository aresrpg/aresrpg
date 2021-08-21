export function last_event_value(emitter, event) {
  let value = null
  emitter.on(event, new_value => (value = new_value))
  return () => value
}
