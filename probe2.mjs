import { readFileSync } from 'node:fs'
import { create_fight_store } from './packages/fight/src/store.js'
import { parse_trace } from './packages/fight/src/trace_recorder.js'
import { engine_view, committed_truth } from './packages/fight/src/project.js'
import { WEAPON_ATTACK_ID } from './packages/fight/src/weapon.js'

const GRID_W = 20
const manhattan = (a, b) => Math.abs((a % GRID_W) - (b % GRID_W)) + Math.abs(Math.floor(a / GRID_W) - Math.floor(b / GRID_W))
const WEAPON = { reach: 1, ap_cost: 4 }

// (A) the CLIENT algorithm — DungeonBoard.jsx:330-335 occupied Map + :477-484 weapon loop
const client_weapon_castable = (mobs, me_cell, ap) => {
  const occupied = new Map()
  mobs.forEach((m, i) => occupied.set(m.cell, { kind: 'mob', alive: m.alive, idx: i }))
  const out = new Set()
  if (ap < WEAPON.ap_cost) return out
  for (const [cell, o] of occupied) {
    if (o.kind !== 'mob' || !o.alive) continue
    const d = manhattan(me_cell, cell)
    if (d < 1 || d > WEAPON.reach) continue
    out.add(cell)
  }
  return out
}
// (B) the CHAIN twin — cast.move:678 find_living_mob_at (a fresh scan, corpses never shadow)
const chain_weapon_castable = (mobs, me_cell, ap) => {
  const out = new Set()
  if (ap < WEAPON.ap_cost) return out
  for (const m of mobs) {
    if (!m.alive) continue
    const d = manhattan(me_cell, m.cell)
    if (d < 1 || d > WEAPON.reach) continue
    out.add(m.cell)
  }
  return out
}

const trace = parse_trace(readFileSync('trace.json', 'utf8'))
const store = create_fight_store()
const rows = []
let first_divergence = null
for (const [idx, { msg, at }] of trace.inputs.entries()) {
  const s = store.getState()
  const ct = committed_truth(s)
  const f = ct.fighters ?? {}
  const me = f.p0
  if (me) {
    const mobs = Object.keys(f).filter((k) => k.startsWith('m')).sort().map((k) => f[k])
    const A = client_weapon_castable(mobs, me.cell, me.ap)
    const B = chain_weapon_castable(mobs, me.cell, me.ap)
    const same = A.size === B.size && [...B].every((c) => A.has(c))
    if (!same && !first_divergence)
      first_divergence = { idx, msg: msg.type, turn: me.turn_number, me_cell: me.cell, ap: me.ap,
        client: [...A], chain: [...B], mobs: mobs.map((m, i) => ({ i, cell: m.cell, hp: m.hp, alive: m.alive })) }
    rows.push({ idx, kind: msg.type, turn: me.turn_number, cell: me.cell, ap: me.ap, armed: s.armed_spell_id, client: [...A].join(','), chain: [...B].join(','), same })
  }
  store.getState().input(msg, at)
}
console.log('FIRST DIVERGENCE (client castable ≠ chain legality):')
console.log(JSON.stringify(first_divergence, null, 2))
console.log('\nDIVERGENT INPUT RANGE:', rows.filter(r => !r.same).length, 'of', rows.length, 'inputs')
console.log('\nWEAPON-ARMED / board_click rows:')
for (const r of rows)
  if (r.armed === WEAPON_ATTACK_ID && r.kind === 'board_click')
    console.log(`  idx ${r.idx} turn ${r.turn} me@${r.cell} ap ${r.ap} | client={${r.client}} chain={${r.chain}} agree=${r.same}`)
