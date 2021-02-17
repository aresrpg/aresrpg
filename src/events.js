export function last_event_value(emitter, event, default_state) {
  let value = default_state
  emitter.on(event, (new_value) => (value = new_value))
  return () => value
}
