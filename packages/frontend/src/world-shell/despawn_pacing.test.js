// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KILL-DESPAWN PACING (live-QA P1, 2026-07-17): a killed mob must not despawn before the attack, the vfx,
// the hit, and the floating number play out — the
// canonical order law: "the HIT, then the numbers, THEN the death").
//
// MECHANISM (proven by this file's red): a LOCAL kill folds hp→0 the instant the click's intent lands
// (prediction — correct, chain parity), and `presented_state` never masks intents ("prediction paints
// first"), so `engine_view` — the ONE projection the adapter's rig reconcile reads
// (board_fight_authority) — reported the mob `dead` in the SAME dispatch as the click. The adapter's R3b
// queue guard (sync_entities' wave_claimed → entity_fold_action `queued`) should have ceded the despawn to
// the sequenced beats, but drain_wave acked LOCAL turns at ENQUEUE ("presented" before anything played),
// emptying the wave in that same dispatch — guard evaporated, fold despawned the rig before one beat played.
//
// THE CONTRACT: the core stays truthful (hp 0 at fold — never delayed); the fighter's PRESENTED liveness
// follows the PRESENTED timeline — `death_presenting_ids` keeps `engine_view.dead` false while its death
// beat still rides an UNACKED wave turn, and the ack ('presented', dispatched at playback SETTLE, capped by
// the tick watchdog) is the one input that reveals the corpse. No timers anywhere: the drain is the clock.

import { describe, expect, test } from 'bun:test'
import { create_fight_store, WAVE_ACK_GRACE_MS } from '@aresrpg/fight/store'
import { local_intent_beats, synthetic_cast_events } from '@aresrpg/fight/present'

import { board_fight_authority, entity_fold_action } from './voxel_fight_folds.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB_CELL = 105

/** A decoded-Fight-shaped object the snapshot door adopts (voxel_fight_ack_window.test.js's harness). */
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
      cell: 100,
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
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** MY killing click, dispatched EXACTLY as DungeonBoard.optimistic_cast does it: the cast intent carrying its
 *  real presentation beats (the REAL producers — synthetic events through local_intent_beats), then the
 *  deterministic passthrough Hit folding the kill THIS frame. */
const local_kill = (store, now = 2_000) => {
  const beats = local_intent_beats(
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_idx: 0,
      target_cell: MOB_CELL,
      victims: [{ is_mob: true, idx: 0, amount: 8, remaining_hp: 0 }],
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
    .input({ type: 'intent', intent: { kind: 'cast', target_cell: MOB_CELL, damaging: true }, beats }, now)
  store
    .getState()
    .input({ type: 'intent', intent: { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 0 } }, now)
  return store
}

/** The adapter's live per-id guards for a standing, not-yet-dying rig (sync_entities' reconcile inputs). */
const RIG_GUARDS = { has_entity: true, is_dying: false, walking: false, replay_owned: false, placed: { x: 5, y: 5 } }

/** The R3b wave claim EXACTLY as sync_entities derives it: actor/victim ids of every unacked wave turn. */
const wave_claim = (store) => {
  const ids = new Set()
  for (const t of store.getState().wave ?? [])
    for (const b of t.beats ?? []) {
      if (b.payload?.entity_id) ids.add(b.payload.entity_id)
      if (b.payload?.target_id) ids.add(b.payload.target_id)
    }
  return ids
}

describe('kill-despawn pacing (P1: the mob must not vanish before its death presents)', () => {
  test('a local kill holds the mob presentation-ALIVE in the adapter authority until its turn presents', () => {
    const store = local_kill(boot())
    const turn = store.getState().wave.find((t) => t.is_local)
    expect(turn, 'the killing click must append a local wave turn').toBeTruthy()
    expect(
      turn.beats.some((b) => b.kind === 'death'),
      'a lethal local cast carries its own death beat'
    ).toBe(true)
    // CORE TRUTH IS NEVER DELAYED: the fold killed the mob the instant the intent landed (chain parity).
    expect(store.getState().fighters.m0.alive).toBe(false)
    // THE P1: while the killing turn's beats (attack → vfx → hit → floater → death) are still unpresented,
    // the projection the adapter's rig reconcile reads must keep the mob PRESENT — alive-for-presentation.
    const held = board_fight_authority({ core: store.getState(), roster: [] })
    expect(held.fighters.get('mob-0').health, 'presented hp stays core-truthful (the mask is liveness-only)').toBe(0)
    expect(held.fighters.get('mob-0').dead, 'death must not present before the killing wave turn drains').toBe(false)
    // ...and the death PRESENTS at the drain: the ack reveals the truthful corpse — never a permanent mask.
    store.getState().input({ type: 'presented', seq: turn.seq }, 3_000)
    const revealed = board_fight_authority({ core: store.getState(), roster: [] })
    expect(revealed.fighters.get('mob-0').dead, 'the ack is the death-present input').toBe(true)
  })

  test('the rig verdict chain: held (never despawn) before the drain, despawn exactly at it', () => {
    const store = local_kill(boot())
    const turn = store.getState().wave.find((t) => t.is_local)
    const pre = board_fight_authority({ core: store.getState(), roster: [] }).fighters.get('mob-0')
    const pre_verdict = entity_fold_action(pre, { ...RIG_GUARDS, queued: wave_claim(store).has('mob-0') })
    expect(pre_verdict.kind, 'the fold must not despawn a mob whose death beats are still queued').not.toBe('despawn')
    store.getState().input({ type: 'presented', seq: turn.seq }, 3_000)
    const post = board_fight_authority({ core: store.getState(), roster: [] }).fighters.get('mob-0')
    const post_verdict = entity_fold_action(post, { ...RIG_GUARDS, queued: wave_claim(store).has('mob-0') })
    expect(post_verdict.kind, 'once the killing turn presented, the fold owns the despawn').toBe('despawn')
  })

  test('a wedged local turn is force-acked by the tick watchdog — the death-present hold is always bounded', () => {
    const store = local_kill(boot())
    const turn = store.getState().wave.find((t) => t.is_local)
    store.getState().input({ type: 'tick' }, 10_000) // first tick stamps the wave_head clock on the LOCAL head
    store.getState().input({ type: 'tick' }, 10_000 + (turn.duration || 0) + WAVE_ACK_GRACE_MS + 1)
    expect(store.getState().wave.length, 'the watchdog must cap a local head too (no unbounded hold)').toBe(0)
    expect(board_fight_authority({ core: store.getState(), roster: [] }).fighters.get('mob-0').dead).toBe(true)
  })

  test('CONTRACT: drain_wave acks at playback SETTLE for every locality — presented means PLAYED', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    // The enqueue-time local ack (the P1 root: it emptied the wave in the click's own dispatch, so the R3b
    // queue guard + the death-present hold evaporated before a single beat played) must stay dead:
    expect(
      source.includes("if (turn.is_local) fight_store.getState().input({ type: 'presented', seq: turn.seq })"),
      'a local turn must never ack at enqueue'
    ).toBe(false)
    // The settle path acks EVERY played turn, locality-independent, right after the claim release:
    expect(source).toMatch(
      /for \(const id of claimed\) replay_owned\.delete\(id\)\s*\n\s*fight_store\.getState\(\)\.input\(\{ type: 'presented', seq: turn\.seq \}\)/
    )
  })
})
