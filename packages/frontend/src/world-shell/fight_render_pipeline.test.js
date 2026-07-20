// RECEIPT RENDER PIPELINE — a chain receipt's inline-resolved wave (turns.move `resolve_from`) is produced into
// ordered render turns (produce_receipt_render_turns) and paced through ONE non-overlapping queue
// (create_fight_render_queue). The predicted half moved into the fight core (fight/present.js — the local wave
// rides input({type:'intent'}) at natural durations), so this spec now covers the RECEIPT half only: the exact
// trap-push beat ORDER a mob cascade plays, and that the queue drains to empty.

import { expect, test } from 'bun:test'
import { produce_receipt_render_turns } from '@aresrpg/fight'

import { create_fight_render_queue } from './fight_render_queue.js'

const encoded = (x, y) => y * 20 + x

const make_clock = () => {
  let now = 0
  return { now: () => now, sleep: async (ms) => void (now += ms), time: () => now }
}

const bind_renders = (label, specs, trace, clock) =>
  specs.map((spec) => ({ ...spec, render: () => trace.push(`${label}:${spec.kind}`) }))

const receipt_events = () => [
  {
    type: '0xENGINE::fight_events::Hit',
    parsedJson: { fight: 'fight-1', victim_is_mob: true, victim_idx: '0', amount: '4', remaining_hp: '6' },
  },
  {
    type: '0xENGINE::fight_events::Displaced',
    parsedJson: {
      fight: 'fight-1',
      target_is_mob: true,
      target_idx: '0',
      kind: '12',
      from_cell: String(encoded(5, 8)),
      to_cell: String(encoded(7, 8)),
      requested: '3',
      blocked: '0',
    },
  },
  {
    type: '0xENGINE::fight_events::Hit',
    parsedJson: { fight: 'fight-1', victim_is_mob: true, victim_idx: '0', amount: '7', remaining_hp: '0' },
  },
  {
    type: '0xENGINE::fight_events::Cast',
    parsedJson: { fight: 'fight-1', caster_is_mob: false, caster_idx: '0', target_cell: String(encoded(5, 8)) },
  },
  {
    type: '0xENGINE::fight_events::MobMoved',
    parsedJson: { fight: 'fight-1', idx: '1', to_cell: String(encoded(9, 8)) },
  },
  {
    type: '0xENGINE::fight_events::Hit',
    parsedJson: { fight: 'fight-1', victim_is_mob: false, victim_idx: '0', amount: '10', remaining_hp: '90' },
  },
  {
    type: '0xENGINE::fight_events::Cast',
    parsedJson: { fight: 'fight-1', caster_is_mob: true, caster_idx: '1', target_cell: String(encoded(4, 8)) },
  },
]

const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? `${is_mob ? 'm' : 'p'}${idx}`

test('a receipt wave produces its trap-push beats in order through one non-overlapping queue', async () => {
  const clock = make_clock()
  const trace = []
  const queue = create_fight_render_queue({ sleep: clock.sleep, now: clock.now })

  const receipt = produce_receipt_render_turns(receipt_events(), {
    fight_id: 'fight-1',
    trap_cells: new Set([encoded(7, 8)]),
    resolve_fighter_id,
    fighter_cells: new Map([['m1', { x: 10, y: 8 }]]),
  })
  // The target entered the trap hit at 6 HP, so its raw 7 overkill renders the clamped 6-point drop.
  expect(receipt.turns[0].events.find((event) => event.kind === 'trap_trigger')?.payload.damage).toBe(6)

  await Promise.all(
    receipt.turns.map((turn) =>
      queue.enqueue_turn({
        source_turn: turn.source_turn,
        events: bind_renders(`receipt-${turn.source_id}`, turn.events, trace, clock),
      })
    )
  )

  // The two mob turns play SERIALLY (never overlapping), each beat in its resolved order: p0's cast → push → trap
  // → damage → death, then m1's move → arrival → cast → damage.
  expect(trace).toEqual([
    'receipt-p0:cast',
    'receipt-p0:displacement',
    'receipt-p0:trap_trigger',
    'receipt-p0:damage',
    'receipt-p0:damage',
    'receipt-p0:death',
    'receipt-m1:move',
    'receipt-m1:arrival',
    'receipt-m1:cast',
    'receipt-m1:damage',
  ])
  expect(queue.size()).toBe(0)
})
