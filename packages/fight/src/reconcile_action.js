// Per-action prediction reconciliation. Only actions whose receipt carries the same absolute/delta fact are
// comparable; silent chain mutations (for example Granted) deliberately wait for the object snapshot.

const fighter_ref = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${Number(idx)}`

const comparable = (action) => {
  switch (action?.kind) {
    case 'Hit':
      return {
        action: `Hit:${fighter_ref(action.victim_is_mob, action.victim_idx)}`,
        delta: { remaining_hp: Number(action.remaining_hp) },
      }
    case 'Moved':
      return { action: `Moved:${String(action.character)}`, delta: { to_cell: Number(action.to_cell) } }
    case 'MobMoved':
      return { action: `MobMoved:m${Number(action.idx)}`, delta: { to_cell: Number(action.to_cell) } }
    case 'Displaced':
      return {
        action: `Displaced:${fighter_ref(action.target_is_mob, action.target_idx)}`,
        delta: { to_cell: Number(action.to_cell) },
      }
    case 'Tackled':
      return {
        action: `Tackled:${fighter_ref(action.runner_is_mob, action.runner_idx)}`,
        delta: { ap_lost: Number(action.ap_lost), mp_lost: Number(action.mp_lost) },
      }
    case 'Drain':
      return {
        action: `Drain:${fighter_ref(action.target_is_mob, action.target_idx)}:${Number(action.point_kind)}`,
        delta: { removed: Number(action.removed) },
      }
    case 'StanceChanged':
      return {
        action: `StanceChanged:${fighter_ref(
          action.fighter_is_mob ?? action.target_is_mob,
          action.fighter_idx ?? action.target_idx
        )}`,
        delta: { active: !!(action.active ?? action.invisible) },
      }
    case 'Placed':
      return { action: `Placed:${String(action.character)}`, delta: { cell: Number(action.cell) } }
    default:
      return null
  }
}

/** First same-action delta mismatch. Authoritative actions have already won the merge when this row is stored. */
export function action_divergence(predicted, applied, { version, at }) {
  const queues = new Map()
  for (const action of predicted ?? []) {
    const row = comparable(action)
    if (!row) continue
    queues.set(row.action, [...(queues.get(row.action) ?? []), row.delta])
  }
  for (const action of applied ?? []) {
    const row = comparable(action)
    const predictions = row ? queues.get(row.action) : null
    if (!row || !predictions?.length) continue
    const [expected, ...remaining] = predictions
    queues.set(row.action, remaining)
    if (JSON.stringify(expected) !== JSON.stringify(row.delta))
      return {
        kind: 'action',
        action: row.action,
        predicted: expected,
        applied: row.delta,
        version: Number(version),
        at,
        shown: false,
      }
  }
  return null
}
