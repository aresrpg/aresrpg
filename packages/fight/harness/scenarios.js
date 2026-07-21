// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/fight harness — the SCENARIO CORPUS the replay-idempotence property (#281) runs over. Each entry
// is a named input log ({ msg, now }[]) driven through the ONE door; the property re-runs it with every
// authoritative input duplicated 2-3× and asserts a byte-identical presentation trace. Plain chain-shaped
// objects, explicit clocks — the same fixture shapes the scenario_solo / spectator_replay suites drive
// (copy > abstract, the house convention for this package's fixtures). Every scenario emits at least one wave
// turn (a non-local mob/peer replay or a local death leg) so the property has real presentation to compare.

import { local_intent_beats, synthetic_cast_events } from '../src/present.js'

import { ev, participant, mob, fight_object, FIGHT, ME, PEER, T0 } from './fixtures.js'

const init = (my_entity_id = ME) => ({
  type: 'init',
  fight_id: FIGHT,
  ctx: { my_entity_id, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
})

// The mob's whole turn as a single receipt: my cast+hit opens it, the mob then moves, casts and strikes back —
// the mob leg paces as ONE non-local wave turn (~3s). A duplicate receipt must add NO second wave (#8).
const mob_exchange = {
  events: [
    ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
    ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 0 }),
    ev('TurnEnded', { is_mob: false, idx: 0 }),
    ev('TurnStarted', { is_mob: true, idx: 0 }),
    ev('MobMoved', { idx: 0, to_cell: 41 }),
    ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
    ev('TurnEnded', { is_mob: true, idx: 0 }),
    ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
  ],
}

// MY optimistic killing cast: the local beats carry the death (attack → hit → floater → death) so the wave
// holds a local death leg. The confirming receipt purges the intent; the death must present EXACTLY once.
const kill_beats = local_intent_beats(
  synthetic_cast_events({
    fight_id: FIGHT,
    caster_idx: 0,
    target_cell: 45,
    victims: [{ is_mob: true, idx: 0, amount: 20, remaining_hp: 0 }],
  }),
  { fight_id: FIGHT }
)

const kill_receipt = {
  events: [
    ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
    ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0, caster_is_mob: false, caster_idx: 0 }),
    ev('Victory', {}),
  ],
}

// M6 (#308): MY optimistic cast (composite predicted, Cast + a non-lethal Hit) survives an intervening UNRELATED
// receipt — a mob acts (moves, strikes ME) between my cast and its confirming receipt. Under the dead purge verb
// that mob receipt deleted my pending cast (HP-rollback); under claims it settles NO claim of mine, so my cast
// lives on and retires silently when its own receipt lands. Redelivered, every authoritative fact here — the mob
// wave AND my confirm — must present exactly once: the claim retire is delivery-idempotent (a redelivery finds
// the prediction already retired, a re-merge dedupes).
const predicted_cast_beats = local_intent_beats(
  synthetic_cast_events({
    fight_id: FIGHT,
    caster_idx: 0,
    target_cell: 45,
    victims: [{ is_mob: true, idx: 0, amount: 8, remaining_hp: 12 }],
  }),
  { fight_id: FIGHT }
)

// A pure mob turn (move + cast + a strike on ME) — it carries NONE of my cast's claim keys (Cast:p0 / Hit:m0),
// and no TurnEnded for my seat, so it is genuinely unrelated to my pending prediction.
const unrelated_mob_turn = {
  events: [
    ev('MobMoved', { idx: 0, to_cell: 41 }),
    ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
  ],
}

const confirm_cast_receipt = {
  events: [
    ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
    ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 0 }),
  ],
}

// Coop: ALICE (ME, seat 0) is the local player; her peer (PEER, seat 1) is non-local, so his committed turn —
// learned only as a wholesale object read — REPLAYS as a paced wave (spectator_replay). A re-read of the same
// object must not double-replay it.
const coop_seats = (peer_cell) => [participant(ME, 21), participant(PEER, peer_cell, { owner: '0xb0b' })]
const coop_fight = (peer_cell, mob_hp) =>
  fight_object({ participants: coop_seats(peer_cell), mobs: [mob(45, { hp: mob_hp })] })

export const SCENARIOS = [
  {
    // A solo mob turn paced as a non-local wave, redelivered — the canonical #8 duplicate-receipt case.
    name: 'solo_mob_turn',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: fight_object(), version: 1 }, now: T0 + 10 },
      {
        msg: {
          type: 'receipt',
          receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
          version: 2,
        },
        now: T0 + 100,
      },
      { msg: { type: 'receipt', receipt: mob_exchange, version: 3 }, now: T0 + 2_000 },
      { msg: { type: 'presented' }, now: T0 + 8_000 },
    ],
  },
  {
    // MY optimistic kill (local death leg) confirmed by a receipt — the death beat must play once through a
    // duplicate confirmation. The double-death family's local half.
    name: 'solo_local_kill',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: fight_object(), version: 1 }, now: T0 + 10 },
      {
        msg: {
          type: 'receipt',
          receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
          version: 2,
        },
        now: T0 + 100,
      },
      {
        msg: {
          type: 'intent',
          intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
          beats: kill_beats,
        },
        now: T0 + 1_200,
      },
      { msg: { type: 'receipt', receipt: kill_receipt, version: 3 }, now: T0 + 2_000 },
      { msg: { type: 'presented' }, now: T0 + 6_000 },
    ],
  },
  {
    // M6 (#308): a predicted cast SURVIVES an unrelated mob receipt and retires on its own — delivery-idempotent.
    name: 'predicted_cast_survives_unrelated_receipt',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: fight_object(), version: 1 }, now: T0 + 10 },
      {
        msg: {
          type: 'receipt',
          receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 30_000 })] },
          version: 2,
        },
        now: T0 + 100,
      },
      {
        msg: {
          type: 'predicted',
          intent_id: 'cast:m6',
          basis_version: 3,
          actions: [
            { kind: 'Cast', caster_is_mob: false, caster_idx: 0, damaging: true, target_cell: 45, ap_cost: 5 },
            { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 12 },
          ],
          beats: predicted_cast_beats,
        },
        now: T0 + 1_200,
      },
      { msg: { type: 'receipt', receipt: unrelated_mob_turn, version: 4 }, now: T0 + 2_000 },
      { msg: { type: 'presented' }, now: T0 + 6_000 },
      { msg: { type: 'receipt', receipt: confirm_cast_receipt, version: 5 }, now: T0 + 6_500 },
    ],
  },
  {
    // A peer's committed turn (walk + cast + damage) revealed only as a wholesale read, paced as a replay wave.
    name: 'coop_peer_turn',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: coop_fight(22, 20), version: 1 }, now: T0 + 10 },
      { msg: { type: 'snapshot', fight: coop_fight(42, 12), version: 2 }, now: T0 + 3_000 },
      { msg: { type: 'presented' }, now: T0 + 6_500 },
    ],
  },
  {
    // A peer's KILL revealed as a wholesale read — the death beat rides the replay. The double-death family's
    // foreign half: a re-delivered post-kill object must not replay the death a second time.
    name: 'coop_peer_kill',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: coop_fight(22, 8), version: 1 }, now: T0 + 10 },
      { msg: { type: 'snapshot', fight: coop_fight(44, 0), version: 2 }, now: T0 + 3_000 },
      { msg: { type: 'presented' }, now: T0 + 6_500 },
    ],
  },
  {
    // Two sequential peer turns, each its own replay wave with an adopt in between — duplicate delivery must
    // stay idempotent ACROSS waves, not just within one.
    name: 'coop_two_peer_waves',
    log: [
      { msg: init(), now: T0 },
      { msg: { type: 'snapshot', fight: coop_fight(22, 20), version: 1 }, now: T0 + 10 },
      { msg: { type: 'snapshot', fight: coop_fight(42, 12), version: 2 }, now: T0 + 3_000 },
      { msg: { type: 'presented' }, now: T0 + 6_100 },
      { msg: { type: 'snapshot', fight: coop_fight(43, 4), version: 3 }, now: T0 + 7_000 },
      { msg: { type: 'presented' }, now: T0 + 10_100 },
    ],
  },
]
