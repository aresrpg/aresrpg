// LEG P — presented HP paces with the beat: the turn card only updates once the vfx ends. engine_view
// exposes `presented_health` = the beat-paced presented fold while a wave drains, the settled committed value when
// nothing presents. LEG Q — every active fighter status (was invisibility-only, kind 27) rides engine_view.effects
// as raw chain ints, so the effect-badges HUD renders a DoT / buff / haze with its chain duration; `invisible` stays
// derived. Both are pure getters on the ONE fold — no new state, no second boolean channel.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { read_fighter_statuses, INVISIBILITY_STATUS_KIND } from '../src/fight_status_snapshot.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const base_fight = (over = {}) => ({
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: enc(5, 5),
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(8, 8), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  ...over,
})

const boot = (fight = base_fight()) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight, version: 5 }, 1_000)
  return store
}
const me = (store) => engine_view(store.getState()).fighters.get(CHAR)

describe('LEG P — the timeline card HP holds with the paced beat, not the instant fold', () => {
  test('presented_health holds pre-damage through a non-local wave, then converges to committed', () => {
    const store = boot()
    // a MOB turn strikes me (50 → 40) — a non-local receipt that PACES a wave (the damage floater the eye follows).
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: enc(5, 5) }),
            ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 10, remaining_hp: 40 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
          ],
        },
      },
      2_000
    )
    const during = me(store)
    expect(during.committed_health, 'the fold KNOWS the damage instantly (committed truth)').toBe(40)
    expect(during.presented_health, 'but the CARD holds pre-damage until the beat drains (paces)').toBe(50)
    expect(during.presented_health, 'presented ≠ committed while the wave presents').not.toBe(during.committed_health)
    // drain the paced wave → the beat presented → presented converges to committed truth
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_500)
    const after = me(store)
    expect(after.presented_health, 'after the beat presents, presented converges to committed').toBe(40)
    expect(after.presented_health).toBe(after.committed_health)
  })
})

describe('LEG Q — every fighter status rides engine_view.effects (was invisibility-only)', () => {
  test('a fighter with 2 statuses (invisibility 2t + ALTER 3t) carries BOTH in effects; invisible still derived', () => {
    // the shim decodes ALL Fight.fx.statuses now (read_fighter_statuses) — 2 rows on my seat (fighter 0).
    const statuses = read_fighter_statuses({
      fx: {
        statuses: [
          { fighter: 0, kind: INVISIBILITY_STATUS_KIND, remaining_turns: 2, effect: {} },
          { fighter: 0, kind: 9, remaining_turns: 3, effect: { stat: 1, value: 5 } }, // K_ALTER_STAT (e.g. MP)
        ],
      },
    })
    const store = boot(base_fight({ invisibility_statuses: statuses }))
    const f = me(store)
    expect(
      f.effects.map((e) => e.kind).sort((a, b) => a - b),
      'both status kinds surface'
    ).toEqual([9, 27])
    const inv = f.effects.find((e) => e.kind === INVISIBILITY_STATUS_KIND)
    const alter = f.effects.find((e) => e.kind === 9)
    expect(inv.remaining_turns, 'invisibility duration carried').toBe(2)
    expect(alter.remaining_turns, 'alter duration carried').toBe(3)
    expect(alter.stat, 'raw effect ints ride through').toBe(1)
    expect(alter.value).toBe(5)
    expect(f.invisible, 'the old boolean stays true — derived from the kind-27 row (one home)').toBe(true)
  })
})
