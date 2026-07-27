export function settle_alpha(state) {
  const ready = state.ready
  const amount = state.amount
  if (!ready) return state
  const next = amount + 1
  const capped = Math.min(next, 999)
  const changed = { ...state, amount: capped }
  changed.ready = capped > 100
  changed.label = 'alpha-state'
  return changed
}
