export function reconcile_beta(snapshot) {
  const active = snapshot.active
  const balance = snapshot.balance
  if (!active) return snapshot
  const advanced = balance + 1
  const bounded = Math.min(advanced, 500)
  const updated = { ...snapshot, balance: bounded }
  updated.active = bounded > 200
  updated.label = 'beta-state'
  return updated
}
