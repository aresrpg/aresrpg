// ③ RECONCILE-ADOPTED DEATH → DESPAWN — a mob dying still kept its model on the fight
// board instead of disappearing. kill_confirm_despawn.test.js locks the PREDICTED/confirmed kill path; this
// locks the OTHER input class — a death proven ONLY by the receipt (the unpredicted trap-kill),
// never optimistically folded. A death is a death regardless of which input proved it: once its wave presents,
// engine_view.dead MUST flip true so the adapter's rig despawns it. Both cases pass at HEAD — the packages/fight
// despawn OUTPUT is correct for the adopt path; any residual lingering-model is downstream (the frontend rig
// consuming engine_view.dead), not this layer.
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view } from './project.js'
import { local_intent_beats, synthetic_cast_events } from './present.js'
import { encode } from './los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = encode(5, 4)
const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
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
      cell: encode(2, 2),
    },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}

describe('③ reconcile-adopted death despawn', () => {
  test('mob killed on MY OWN turn via receipt (unpredicted trap) despawns after the wave presents', () => {
    const store = boot()
    // reconcile-adopt: my turn's receipt lands the mob dead (a trap I pushed it onto — I never predicted it)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: false, idx: 0 }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 8,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
          ],
        },
      },
      4_000
    )
    expect(mob0(store).health, 'hp folds to 0 (chain truth)').toBe(0)
    drain(store, 4_500)
    expect(mob0(store).dead, 'a reconcile-adopted death must despawn once its wave presents').toBe(true)
  })

  test('optimistic hit leaves the mob alive, then the receipt adopts a trap-kill it never predicted', () => {
    const store = boot()
    // I optimistically damage the mob but it SURVIVES in my prediction (the trap damage was NOT predicted — ①).
    const beats = local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: MOB_CELL,
        victims: [{ is_mob: true, idx: 0, amount: 5, remaining_hp: 3 }],
      }),
      {
        fight_id: FIGHT,
        resolve_fighter_id: ({ is_mob, idx, character }) =>
          character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR,
        resolve_cast: () => ({ spell_id: 'ember_strike' }),
      }
    )
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: MOB_CELL, damaging: true }, beats }, 2_000)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 3 } }, 2_000)
    expect(mob0(store).health, 'prediction leaves the mob alive at 3').toBe(3)
    drain(store, 2_500) // my optimistic turn presents (no death — the trap was unpredicted)
    expect(mob0(store).dead).toBe(false)
    // now the receipt for MY turn lands the mob DEAD (the trap kill I never predicted)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: {
          events: [
            ev('TurnStarted', { is_mob: false, idx: 0 }),
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 8,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 0,
            }),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
          ],
        },
      },
      3_000
    )
    expect(mob0(store).health, 'the receipt adopts the trap kill').toBe(0)
    drain(store, 3_500)
    expect(mob0(store).dead, 'the adopted trap-kill must despawn — a death is a death').toBe(true)
  })
})
