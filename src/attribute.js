export function delay_to_generic_attack_speed(delay) {
  const delay_in_seconds = delay / 1000
  return 1 / delay_in_seconds
}
