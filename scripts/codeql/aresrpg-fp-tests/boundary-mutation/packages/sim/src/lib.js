// Fixtures for js/aresrpg/boundary-mutation (CODE_LAW L-I2) — parameters are the caller's.

// RED A — direct property write through an exported function's parameter.
export const apply_damage = (unit, dmg) => {
  unit.hp = unit.hp - dmg
  return unit
}

// RED B — alias mutation (the lexical no-param-reassign cannot see this).
export const rename = (unit, name) => {
  const u = unit
  u.name = name
  return u
}

// RED C — deep member write: the chain root is still the caller's value.
export const tag = (unit) => {
  unit.meta.tags = ['x']
}

// RED D — mutating method through a nested member.
export const enqueue = (state, item) => {
  state.queue.push(item)
}

// RED E — transitive: the exported function hands its param to a local mutator (`delete`).
const strip_local = (o) => {
  delete o.secret
}
export const sanitize = (o) => {
  strip_local(o)
  return o
}

// GREEN 1 — copy-first: a fresh spread is L-I3 construction, not mutation.
export const pure_damage = (unit, dmg) => ({ ...unit, hp: unit.hp - dmg })

// GREEN 2 — fresh local construction is legal (freshness, not ownership).
export const build = () => {
  const fresh = { hp: 1 }
  fresh.hp = 2
  return fresh
}

// GREEN 3 — the React ref contract (`.current`) is the platform's mutable cell.
export const attach = (ref, v) => {
  ref.current = v
}

// GREEN 4 — copy-then-sort never touches the caller's array.
export const ordered = (xs) => [...xs].sort()
