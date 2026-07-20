// IN-FIGHT VEIL contract (a gatherable resource used to float above the fight board): entering a
// world fight must hide EVERY roam population from the tactical board — mob groups AND gatherable resource nodes
// alike — and hand them all back when the fight unmounts. RED-FIRST proof at the applier level: the reported
// reason is that the veil exempts gatherables (they float above the board), so a mixed set must mask uniformly.
// Pure, headless — the entries are duck-typed fakes (no three, no engine, no DOM).

import { describe, expect, it } from 'bun:test'

import { apply_veil } from './spawn_veil.js'

// A mob group is member RIGS (no mesh); a gatherable node is a billboard MESH (no members). Both carry a chip.
const mob_entry = () => ({
  kind: 'mob',
  members: [{ rig: { root: { visible: true } } }, { rig: { root: { visible: true } } }],
  mesh: null,
  chip: { style: { display: '' } },
})
const node_entry = () => ({
  kind: 'resource',
  members: [],
  mesh: { visible: true },
  chip: { style: { display: '' } },
})

describe('apply_veil — the in-fight mask hides EVERY roam population', () => {
  it('veiled: hides the gatherable node mesh AND its chip (the board-leak repro)', () => {
    const node = node_entry()
    apply_veil([node], true)
    expect(node.mesh.visible, 'a gatherable node must not float above the fight board').toBe(false)
    expect(node.chip.style.display, 'nor its floating resource-name chip').toBe('none')
  })

  it('veiled: still hides mob member rigs + chip (the population that already masked)', () => {
    const mob = mob_entry()
    apply_veil([mob], true)
    for (const m of mob.members) expect(m.rig.root.visible).toBe(false)
    expect(mob.chip.style.display).toBe('none')
  })

  it('a mixed set is masked uniformly — no kind is exempt', () => {
    const mob = mob_entry()
    const node = node_entry()
    apply_veil([mob, node], true)
    expect(node.mesh.visible).toBe(false)
    for (const m of mob.members) expect(m.rig.root.visible).toBe(false)
  })

  it('unveiled (fight over): the gatherable RETURNS — the world never loses gatherables after a fight', () => {
    const node = node_entry()
    apply_veil([node], true) // fight starts → hidden
    apply_veil([node], false) // fight ends → handed back
    expect(node.mesh.visible).toBe(true)
    expect(node.chip.style.display).toBe('')
  })

  it('the engaged group stays hidden even unveiled (its own optimistic fight-entry beat owns it)', () => {
    const mob = { ...mob_entry(), engaged: true }
    apply_veil([mob], false)
    for (const m of mob.members) expect(m.rig.root.visible).toBe(false)
    expect(mob.chip.style.display).toBe('none')
  })
})
