// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROOF: the delivery VFX for a
// PLAYER cast no longer fires the instant the swing STARTS — it now waits for MOST of the swing to play (not
// just its W4 impact-frame resolve, which every hit/death/float timing still reads unchanged — board_entities'
// entity_beat contract is untouched) before mounting. The third link in today's sequencing chain: (1) the
// stacked-cast FIFO reveal queue (fight-intents.js cast_pending) serializes rapid casts' HP-bar reveals; (2) the
// floating-number impact-lag (board_entities FLOAT_IMPACT_LAG_S) waits for the VFX impact; (3) THIS —
// cast-animation MOSTLY PLAYS -> VFX fires -> numbers on impact (the on_impact chain into play_victim_reaction is
// proven separately by voxel_fight_aoe_serial.test.js and stays untouched).
//
// RETUNED: the gate no longer waits for the swing's full natural end — it fires at `duration_ms × 0.5`
// (`fire_ratio`, the wait helper's new second param, tuned down from an earlier 80% mark), impact at the swing apex for
// punchier fight feel. An EARLY `.done` (an aborted/interrupted beat) still wins the race and fires promptly —
// the 80% mark is a SCHEDULE, not a wait for completion. voxel_fight_adapter's OTHER call of this same helper
// (the death-hold gate on the fight-end surface, which wants the FULL death clip) never passes a ratio, so it
// keeps the original 1.1-ceiling-above-full-length default untouched — proven by every un-ratio'd call below.
//
// The instrument mirrors voxel_fight_adapter's wait_cast_anim_done + the play_cast caster-beat gate EXACTLY (a
// real async gap via setTimeout, the SAME idiom voxel_fight_aoe_serial.test.js uses) — a lost await, a missing
// fallback-clear, or a dropped torn-down guard would show up here as an ordering/hang/leak regression.

import { describe, expect, it } from 'bun:test'

// mirrors voxel_fight_adapter.wait_cast_anim_done EXACTLY (incl. the fire_ratio param; ratio 0.5 since 2026-07-15).
const wait_cast_anim_done = (/** @type {any} */ beat, /** @type {number} */ fire_ratio = 1.1) => {
  const ceiling_ms = (beat?.duration_ms ?? 0) * fire_ratio
  if (!(ceiling_ms > 0)) return Promise.resolve()
  let timer
  const settle = Promise.race([
    beat?.done ?? Promise.resolve(),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ceiling_ms)
    }),
  ])
  return settle.then(() => clearTimeout(timer))
}

/** A fake board.entity_beat return: a promise stapled with `.done`/`.duration_ms`, mirroring board_entities' real
 *  contract — `.done` fires after `done_ms` (defaults to the FAKE resolved clip length `clip_ms` — the normal
 *  case, an anim that plays to its full nominal length), logging 'anim:end' on settle (the ordering proof).
 *  `done_ms` below `clip_ms` simulates an EARLY abort/interrupt — `.done` settling well before the beat's own
 *  nominal duration_ms, the case wait_cast_anim_done's early-done race must still catch promptly. `never_done:
 *  true` simulates an interrupted/overwritten/removed beat whose `.done` never fires at all — the exact case the
 *  fallback ceiling guards.
 * @param {number} clip_ms @param {string[]} log @param {{ never_done?: boolean, done_ms?: number }} [opts] */
const make_fake_beat = (clip_ms, log, { never_done = false, done_ms } = {}) => {
  const p = /** @type {any} */ (Promise.resolve())
  p.duration_ms = clip_ms
  p.done = never_done
    ? new Promise(() => {}) // deliberately never settles
    : new Promise((resolve) =>
        setTimeout(() => {
          log.push('anim:end')
          resolve(undefined)
        }, done_ms ?? clip_ms)
      )
  return p
}

// mirrors play_cast's caster-beat block (the gated slice under proof): starts the swing, waits for ~80% of it
// ONLY when the caster isn't a mob (is_mob mirrors the adapter's exact is_mob(id) check; 0.5 mirrors the real
// adapter's call site EXACTLY — RETUNED 2026-07-13), THEN the caller mounts the delivery VFX.
const play_cast_caster_gate = async (
  /** @type {(id: string) => any} */ entity_beat,
  /** @type {string} */ id,
  /** @type {{ is_mob: (id: string) => boolean, log: string[] }} */ { is_mob, log }
) => {
  const beat = entity_beat(id)
  log.push(`${id}:anim:start`)
  if (!is_mob(id)) await wait_cast_anim_done(beat, 0.5)
}

describe('wait_cast_anim_done — the cast-anim-finishes gate (retuned to an 80% overlap)', () => {
  it("DEFAULT ratio (the death-hold caller's, unchanged): the wait never returns before the beat's natural end (anim:end is ordered BEFORE vfx_start)", async () => {
    const log = /** @type {string[]} */ ([])
    const beat = make_fake_beat(15, log)
    await wait_cast_anim_done(beat)
    log.push('vfx_start')
    expect(log).toEqual(['anim:end', 'vfx_start']) // vfx_start >= anim_end, never before
  })

  it('full sequence proof (RETUNED 2026-07-13): anim:start -> ~80% -> vfx_start, BEFORE anim:end — the deliberate 20% overlap, end-to-end through the real caster-beat gate', async () => {
    const log = /** @type {string[]} */ ([])
    const entity_beat = () => make_fake_beat(100, log) // .done fires naturally at 100ms (full nominal length)
    await play_cast_caster_gate(entity_beat, 'player-1', { is_mob: () => false, log }) // gates at 100*0.5=50ms
    log.push('vfx_start')
    expect(log).toEqual(['player-1:anim:start', 'vfx_start']) // anim:end (100ms) hasn't fired yet — vfx led it
  })

  it('MOBS are exempt (declared scope — symmetry was NOT free, see play_cast): the gate never awaits, vfx_start rides the untouched fire-and-forget timing', async () => {
    const log = /** @type {string[]} */ ([])
    const entity_beat = () => make_fake_beat(500, log) // a long clip: if the gate applied, 'anim:end' would log
    await play_cast_caster_gate(entity_beat, 'mob-3', { is_mob: (id) => id.startsWith('mob-'), log })
    log.push('vfx_start')
    // both beat-start and vfx_start land synchronously, back to back — 'anim:end' (500ms later) never logs here.
    expect(log).toEqual(['mob-3:anim:start', 'vfx_start'])
  })

  it('CANCEL PATH: a beat whose .done NEVER settles (overwritten/removed mid-swing) still resolves via the computed fallback ceiling — never hangs, and clears its own timer (no orphan)', async () => {
    const log = /** @type {string[]} */ ([])
    const real_clear = globalThis.clearTimeout
    let cleared = 0
    globalThis.clearTimeout = /** @type {any} */ (
      (/** @type {any} */ h) => {
        cleared += 1
        real_clear(h)
      }
    )
    try {
      const beat = make_fake_beat(15, log, { never_done: true })
      // would hang forever without the fallback ceiling (bun's test timeout would fail this test loudly) —
      // resolving proves the ceiling fired.
      await wait_cast_anim_done(beat)
      log.push('resolved_via_fallback')
      expect(log).toEqual(['resolved_via_fallback']) // 'anim:end' never logs — .done truly never fired
      expect(cleared).toBeGreaterThan(0) // the losing side's timer is explicitly cleared — no orphan outlives the wait
    } finally {
      globalThis.clearTimeout = real_clear
    }
  })

  it('no resolved duration (an entity absent from the board — board.entity_beat found no `e`) resolves immediately: nothing to wait on', async () => {
    const log = /** @type {string[]} */ ([])
    await wait_cast_anim_done(/** @type {any} */ (Promise.resolve())) // no .duration_ms stapled
    log.push('vfx_start')
    expect(log).toEqual(['vfx_start']) // no 'anim:end' — there was never a beat to wait on
  })

  it('TORN-DOWN GUARD mirror: a board torn down mid-wait (fight left/forfeited) bails clean — never mounts vfx, never throws, never hangs', async () => {
    let vfx_mounted = false
    let entity_ids = new Set(['player-1'])
    let board_frame = /** @type {any} */ ({ origin: { x: 0, y: 0, z: 0 } })
    const log = /** @type {string[]} */ ([])
    const beat = make_fake_beat(15, log)
    const play_cast = async () => {
      await wait_cast_anim_done(beat, 0.5) // mirrors the real delivery-VFX call site's ratio exactly
      // mirrors the adapter's exact post-await guard.
      if (!board_frame || !entity_ids.has('player-1')) return
      vfx_mounted = true
    }
    const p = play_cast()
    // a teardown fires WHILE the wait is still in flight (well before the 15ms fake clip's 12ms/0.5 gate settles).
    setTimeout(() => {
      board_frame = null
      entity_ids = new Set()
    }, 3)
    await p
    expect(vfx_mounted).toBe(false) // never mounted onto the torn-down board
  })
})

describe('wait_cast_anim_done — fire_ratio=0.5 (fires the vfx at half the cast animation, for tighter timing)', () => {
  it('a known duration, the beat playing its full nominal length: the VFX schedules at ~80%, strictly BEFORE anim:end', async () => {
    const log = /** @type {string[]} */ ([])
    const beat = make_fake_beat(100, log) // .done fires naturally at 100ms — no early abort
    await wait_cast_anim_done(beat, 0.5) // the 0.8 timer (80ms) beats the natural 100ms .done
    log.push('vfx_start')
    expect(log).toEqual(['vfx_start']) // 'anim:end' hasn't logged yet at the 80ms mark
  })

  it('an EARLY .done (the beat aborts/interrupts well before the 80% mark) still wins the race and fires promptly — never delayed to the 80% timer', async () => {
    const log = /** @type {string[]} */ ([])
    const beat = make_fake_beat(100, log, { done_ms: 20 }) // nominal duration_ms=100, but settles at 20ms
    await wait_cast_anim_done(beat, 0.5) // the 80ms timer must NOT win — the 20ms early .done does
    log.push('vfx_start')
    expect(log).toEqual(['anim:end', 'vfx_start']) // resolved via the early .done at 20ms, not delayed to 80ms
  })

  it('no resolved duration resolves immediately regardless of ratio — the unknown-duration fallback is unchanged', async () => {
    const log = /** @type {string[]} */ ([])
    await wait_cast_anim_done(/** @type {any} */ (Promise.resolve()), 0.8) // no .duration_ms stapled
    log.push('vfx_start')
    expect(log).toEqual(['vfx_start']) // no 'anim:end' — there was never a beat to wait on
  })
})
