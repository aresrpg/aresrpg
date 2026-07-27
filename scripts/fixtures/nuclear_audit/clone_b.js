export function reconcile_beta(snapshot) {
  const active = snapshot.active
  const balance = snapshot.balance
  if (!active) return snapshot
  const advanced = balance + 1
  const bounded = Math.min(advanced, 999)
  const updated = { ...snapshot, balance: bounded }
  updated.active = bounded > 100
  updated.label = 'alpha-state'
  return updated
}
