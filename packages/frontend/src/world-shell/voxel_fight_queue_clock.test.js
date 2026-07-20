// M3 P3 — THE QUEUE-CLOCK ASSERT (M1a's named follow-up, the wave-clock conviction's guard at the ADAPTER
// tier). The core stamps every wave turn's beats on a PER-TURN clock (present.js pace_segment: `at` from 0 at
// the turn's OWN head — the §A1 fix), and the adapter's serial render queue (fight_render_queue) anchors each
// enqueued turn at ITS OWN head (`turn_started_at + slot.at`). This spec drives the REAL core (a receipt with
// TWO mob turns through the one door) and the REAL queue on a fake clock, exactly the shape drain_wave binds
// ({kind, at, duration, render}), and pins:
//   1. every beat fires at (its turn's head) + (the core-stamped `at`) — the stamps are consumed VERBATIM;
//   2. turn 2's beats anchor at turn 1's END (~3000), never at segment-absolute offsets — the multi-mob
//      dead-air class (turn N playing (N−1)×3s late) cannot re-enter through the adapter tier.

import { describe, expect, test } from 'bun:test'
import { create_fight_store, MOB_TURN_MS } from '@aresrpg/fight'

import { create_fight_render_queue } from './fight_render_queue.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const fight_object = () => ({
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
      cell: 45,
      stats: { agility: 40 },
    },
  ],
  mobs: [
    { template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 },
    { template: '0xabc', hp: 30, max_hp: 30, cell: 205, ap: 4, mp: 3, level: 1 },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

/** My end-turn resolving BOTH mob turns in one receipt — the two-mob cascade of the §A1 dead-air class. */
const two_mob_receipt = () => [
  ev('TurnEnded', { is_mob: false, idx: 0 }),
  ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
  ev('MobMoved', { idx: 0, to_cell: 85 }),
  ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 45 }),
  ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
  ev('TurnEnded', { is_mob: true, idx: 0 }),
  ev('TurnStarted', { is_mob: true, idx: 1, deadline_ms: 0 }),
  ev('Cast', { caster_is_mob: true, caster_idx: 1, target_cell: 45 }),
  ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 4, remaining_hp: 40, caster_is_mob: true, caster_idx: 1 }),
  ev('TurnEnded', { is_mob: true, idx: 1 }),
  ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
]

const make_clock = () => {
  let now = 0
  return { now: () => now, sleep: async (ms) => void (now += ms) }
}

const core_wave = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } }, 1000)
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1000)
  store.getState().input({ type: 'receipt', receipt: two_mob_receipt(), version: 6 }, 2000)
  return store.getState().wave.filter((t) => !t.is_local)
}

describe('M3 P3 · the adapter queue schedules beats on the per-turn clock the core stamps', () => {
  test('two mob turns: every beat fires at (own turn head) + (core-stamped at); turn 2 anchors at ~3000, never 6000', async () => {
    const wave = core_wave()
    expect(wave.length).toBe(2) // mob-0 then mob-1
    for (const turn of wave) {
      expect(turn.duration).toBe(MOB_TURN_MS)
      // the core's §A1 contract: beats anchor at the turn's OWN head — the first beat's at is 0
      expect(Math.min(...turn.beats.map((b) => b.at))).toBe(0)
    }
    const clock = make_clock()
    const queue = create_fight_render_queue({ sleep: clock.sleep, now: clock.now })
    /** @type {{ seq: number, kind: string, at: number, fired_at: number }[]} */
    const fired = []
    const played = wave.map((turn) =>
      queue.enqueue_turn({
        source_turn: `wave:${turn.seq}`,
        // EXACTLY the drain_wave binding shape: the core-stamped at/duration ride through UNCHANGED.
        events: turn.beats.map((b) => ({
          kind: b.kind,
          at: b.at,
          duration: b.duration,
          render: () => void fired.push({ seq: turn.seq, kind: b.kind, at: b.at, fired_at: clock.now() }),
        })),
      })
    )
    await Promise.all(played)

    const heads = new Map() // seq → the wall clock the turn reached the queue head
    heads.set(wave[0].seq, 0)
    heads.set(wave[1].seq, MOB_TURN_MS) // turn 2's head = turn 1's END (serial queue, 3000ms slot)
    for (const f of fired) {
      // 1. the per-turn clock law: fire time == own head + the core-stamped at, verbatim
      expect(f.fired_at).toBe(heads.get(f.seq) + f.at)
    }
    // 2. the dead-air class stays dead: turn 2's FIRST beat fires AT its head (3000) — not (N−1)×slot late
    const t2_first = fired.filter((f) => f.seq === wave[1].seq).reduce((a, f) => (f.fired_at < a.fired_at ? f : a))
    expect(t2_first.fired_at).toBe(MOB_TURN_MS)
    // and the whole wave spans exactly 2 slots (the trailing zero-length turn_end marker rides AT the slot
    // boundary — the rescale law places bookkeeping at the slot end, so equality IS the contract)
    expect(Math.max(...fired.map((f) => f.fired_at))).toBeLessThanOrEqual(2 * MOB_TURN_MS)
  })

  test('CONTROLLED RED TWIN — segment-absolute stamps (the pre-§A1 core) would push turn 2 a full slot late; the law above discriminates', async () => {
    const wave = core_wave()
    const clock = make_clock()
    const queue = create_fight_render_queue({ sleep: clock.sleep, now: clock.now })
    const fired = []
    // INJECT the dead-air class: turn 2's beats carry SEGMENT-absolute at (shifted by turn 1's slot) — what a
    // segment-clocked core would emit. The queue (correctly per-turn) then plays them one whole slot LATE.
    const injected = wave.map((turn, i) => ({
      ...turn,
      beats: turn.beats.map((b) => ({ ...b, at: b.at + i * MOB_TURN_MS })),
    }))
    await Promise.all(
      injected.map((turn) =>
        queue.enqueue_turn({
          source_turn: `wave:${turn.seq}`,
          events: turn.beats.map((b) => ({
            kind: b.kind,
            at: b.at,
            duration: b.duration,
            render: () => void fired.push({ seq: turn.seq, fired_at: clock.now() }),
          })),
        })
      )
    )
    const t2_first = fired.filter((f) => f.seq === injected[1].seq).reduce((a, f) => (f.fired_at < a.fired_at ? f : a))
    expect(t2_first.fired_at).toBe(2 * MOB_TURN_MS) // 6000 — the §A1 dead-air symptom, proving the discriminator
  })
})
