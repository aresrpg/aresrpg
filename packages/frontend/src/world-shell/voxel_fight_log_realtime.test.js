// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COMBAT-LOG REALTIME — the interleaving proof for a reported bug: "the combat log doesn't
// appear during the fight, it's flushing after instead of real time." ROOT: the log lines were composed in
// fight.js's fightCastResult dispatch handler, which fires for a WHOLE turn cascade in ONE synchronous poll — so
// every cast/hit/death line dumped at once while voxel_fight_adapter paced the matching VISUAL beats out over
// seconds. FIX: the lines now compose (still in fight.js — one home) but fire AT each beat inside the adapter's
// playback (emit_cast_context_line at the swing, emit_effect_line at each victim flinch, emit_death_line at the
// death beat, emit_trap_line at a trap trigger).
//
// THIS proof drives the REAL production emitters through a faithful MIRROR of voxel_fight_adapter's beat loop
// (play_cast_inner → play_victim_reaction, and play_move → play_trap_trigger) with a mock board whose entity_beat
// resolves after a REAL async gap — the SAME modelling law voxel_fight_move_playback.test.js uses (a missing
// await would reorder the stream; the pixels ride the live Playwright synth rig, combat_log_realtime.spec.ts). It
// records a unified {beat | log} timeline with high-res timestamps and asserts the log entries INTERLEAVE with
// the beats and are SPREAD across the replay window — never clustered at one instant the way the batch flush was.
//
// REAL code under proof: beats_from_packet + split_move_at_traps (voxel_fight_folds.js) build the exact beats the
// adapter plays; emit_cast_context_line / emit_effect_line / emit_death_line / emit_trap_line (fight.js) are the
// exact production composers the adapter now calls at those beats.

import fs from 'node:fs'

import { describe, it, expect } from 'bun:test'

import {
  emit_cast_context_line,
  emit_effect_line,
  emit_death_line,
  emit_trap_line,
} from '../game/core/modules/fight.js'

import { beats_from_packet, split_move_at_traps } from './voxel_fight_folds.js'

const TICK_MS = 8
const tick = () => new Promise((r) => setTimeout(r, TICK_MS)) // a real async gap — a missing await reorders it

/** A recording rig: beats stamp via the mock board, log lines stamp via the dispatch the REAL emit_* call. Every
 *  entry carries a high-res `t` (ms since fight-start) so the timeline proves ordering AND spread, not just order. */
const make_rig = (fighters) => {
  const timeline = /** @type {{ kind: string, t: number, [k: string]: any }[]} */ ([])
  const t0 = performance.now()
  const at = () => performance.now() - t0
  const mark = (kind, extra = {}) => timeline.push({ kind, t: at(), ...extra })
  const get_state = () => ({ fight: { fighters } })
  // the dispatch the production emitters call — each combat-log line lands here, timestamped, tagged by its id
  // prefix (combat_log_line stamps `${prefix}-${seq}`: 'cast-3' → 'cast', 'hit-4' → 'hit', 'trap-9' → 'trap', …).
  const dispatch = (type, payload) => {
    if (type !== 'action/chat_message') return
    mark('log', { prefix: String(payload.id).replace(/-\d+$/, ''), message: payload.message })
  }
  // mock board.entity_beat: the base promise resolves at IMPACT (the damage floater's mount frame); `.done`
  // resolves one real gap later at the beat's NATURAL END. This is the production BoardHandle contract and lets
  // the trap-walk proof distinguish "number appeared" from "the on-enter presentation finished".
  const board_beat = (id, anim) => {
    mark('beat', { id, anim })
    const impact = tick().then(() => mark('beat-impact', { id, anim }))
    const beat = /** @type {Promise<void> & { done: Promise<void>, duration_ms: number }} */ (
      /** @type {any} */ (impact)
    )
    beat.done = impact.then(async () => {
      await tick()
      mark('beat-done', { id, anim })
    })
    beat.duration_ms = TICK_MS * 2
    return beat
  }
  return { timeline, get_state, dispatch, board_beat, mark }
}

/** A CHARACTER-FOR-CHARACTER mirror of voxel_fight_adapter.play_cast_inner's log-emitting beat loop: the context
 *  line at the cast's own beat, the caster swing, then play_victim_reaction (non-damage lines at the delivery
 *  landing; each damage line + its death line AT the victim's flinch/death beat). */
const play_cast_mirror = async (rig, packet) => {
  const { get_state, dispatch, board_beat } = rig
  // play_cast_inner TOP: the "<caster> cast <spell>" line fires at the cast's own beat — before the swing.
  emit_cast_context_line(get_state, dispatch, { entity_id: packet.entity_id, spell_id: packet.spell_id })
  const [caster_beat, ...victim_beats] = beats_from_packet(packet)
  const effects = packet.effects ?? []
  if (caster_beat) await board_beat(caster_beat.id, 'attack') // the swing (player: awaited)
  // play_victim_reaction: NON-DAMAGE effect lines (no victim beat) stream once at the delivery landing.
  for (const e of effects)
    if ((e?.damage ?? 0) <= 0)
      emit_effect_line(get_state, dispatch, { entity_id: packet.entity_id, effect: e, is_critical: packet.is_critical })
  for (const beat of victim_beats) {
    const done = board_beat(beat.id, 'hit') // the flinch/floater beat starts…
    const dmg_effect = effects.find((e) => e?.target_id === beat.id && (e?.damage ?? 0) > 0)
    if (dmg_effect)
      emit_effect_line(get_state, dispatch, {
        entity_id: packet.entity_id,
        effect: dmg_effect,
        is_critical: packet.is_critical,
      }) // …its line rides it
    await done
    if (beat.then_death) {
      const death_done = board_beat(beat.id, 'death') // the death beat starts…
      emit_death_line(get_state, dispatch, { target_id: beat.id }) // …the death line rides it (UNCONDITIONAL — post-fold)
      await death_done
    }
  }
}

/** A mirror of voxel_fight_adapter.play_move's trap loop (real split_move_at_traps): walk → PAUSE at the trap
 *  cell (the flinch beat + emit_trap_line) → RESUME. */
const play_move_mirror = async (rig, packet) => {
  const { get_state, dispatch, board_beat, mark } = rig
  for (const step of split_move_at_traps(packet.path, packet.trap_hits)) {
    if (step.walk.length) {
      mark('walk', { cell: step.walk.at(-1) })
      await tick()
    }
    if (step.trap) {
      const done = board_beat(packet.entity_id, 'hit') // the trap flinch beat starts…
      emit_trap_line(get_state, dispatch, {
        owner_id: packet.trap_owner_id,
        target_id: packet.entity_id,
        damage: step.trap.damage,
      }) // …its line rides it
      // A trap is an on-enter beat in the move fold: the resume leg cannot start at IMPACT (when the number only
      // mounts); it waits for the flinch/floater presentation's natural end, exactly like the production adapter.
      await (done.done ?? done)
    }
  }
}

const logs = (timeline) => timeline.filter((e) => e.kind === 'log')
const idx = (timeline, pred) => timeline.findIndex(pred)

describe('combat log streams AT the beats, not as a post-cascade flush', () => {
  it('trap-attributed receipt damage never falls through the generic actor hit log', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain('source_id: spec.payload?.trap_damage ? null')
    expect(source).toContain('event.source_id && floater && !event.trap_damage')
  })

  it('a lethal single-target cast: cast → (swing) → hit → (death beat) → death, each line ON its beat', async () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat', dead: true }], // post-fold the fold already flipped it dead
    ])
    const rig = make_rig(fighters)
    await play_cast_mirror(rig, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', damage: 12, has_health: true, killed: true }],
      is_critical: false,
    })
    const terminal = rig.timeline.at(-1).t
    const tl = rig.timeline

    // the three lines fired, in the expected order.
    expect(logs(tl).map((l) => l.prefix)).toEqual(['cast', 'hit', 'death'])

    // INTERLEAVING — each line rides its beat, not a batch:
    //   the cast line lands BEFORE the swing beat; the hit line AFTER the flinch beat; the death AFTER the death beat.
    expect(idx(tl, (e) => e.kind === 'log' && e.prefix === 'cast')).toBeLessThan(
      idx(tl, (e) => e.kind === 'beat' && e.anim === 'attack')
    )
    expect(idx(tl, (e) => e.kind === 'beat' && e.anim === 'hit')).toBeLessThan(
      idx(tl, (e) => e.kind === 'log' && e.prefix === 'hit')
    )
    expect(idx(tl, (e) => e.kind === 'beat' && e.anim === 'death')).toBeLessThan(
      idx(tl, (e) => e.kind === 'log' && e.prefix === 'death')
    )

    // SPREAD — the lines are NOT clustered at one instant (the batch-flush signature). The death line lands at
    // least a full beat-gap after the cast line (swing + flinch + death beats separate them). Every line's
    // timestamp is strictly inside (fight-start=0, terminal) — never dumped post-terminal.
    const t = (p) => logs(tl).find((l) => l.prefix === p).t
    expect(t('death') - t('cast')).toBeGreaterThanOrEqual(TICK_MS)
    for (const l of logs(tl)) {
      expect(l.t).toBeGreaterThan(0)
      expect(l.t).toBeLessThanOrEqual(terminal)
    }
    // artifact evidence for the report (diagnostic-only; the assertions above are the actual gate).
    try {
      const OUT = process.env.ARES_TEST_OUT ?? new URL('../../test-results/out', import.meta.url).pathname
      fs.mkdirSync(OUT, { recursive: true })
      fs.writeFileSync(`${OUT}/combat_log_realtime_timeline.json`, JSON.stringify({ terminal, timeline: tl }, null, 2))
    } catch {
      /* diagnostic only */
    }
  })

  it(
    'an AoE with a heal: the heal line lands at the delivery, both hits ride their own flinch beats, the kill\n' +
      'chains its death — five interleaved lines, spread across the replay',
    async () => {
      const fighters = new Map([
        ['p1', { name: 'Aldric' }],
        ['mob-0', { name: 'Sewer Rat', dead: false }],
        ['mob-1', { name: 'Cave Crab', dead: true }],
        ['p2', { name: 'Elena' }],
      ])
      const rig = make_rig(fighters)
      await play_cast_mirror(rig, {
        entity_id: 'p1',
        spell_id: 'dungeon_strike',
        effects: [
          { target_id: 'mob-0', damage: 10, has_health: true, killed: false },
          { target_id: 'mob-1', damage: 5, has_health: true, killed: true },
          { target_id: 'p2', heal: 6, has_health: true },
        ],
        is_critical: false,
      })
      const tl = rig.timeline
      const seq = logs(tl).map((l) => l.prefix)
      // cast first, the non-damage heal at the delivery landing, then each hit at its beat, the kill's death last.
      expect(seq).toEqual(['cast', 'heal', 'hit', 'hit', 'death'])
      expect(logs(tl).find((l) => l.prefix === 'heal').message).toBe('Aldric healed Elena for +6')
      // Each hit rides its own serial victim beat. Prove that ordering from the timeline itself: the first
      // victim's awaited impact sits between the two log lines. A requested timer delay is not an elapsed-time
      // lower bound — event loops may legally wake a fractional millisecond early.
      const hit_log_is = tl
        .map((event, index) => (event.kind === 'log' && event.prefix === 'hit' ? index : -1))
        .filter((index) => index >= 0)
      const first_hit_impact_i = idx(
        tl,
        (event) => event.kind === 'beat-impact' && event.anim === 'hit' && event.id === 'mob-0'
      )
      expect(hit_log_is[0]).toBeLessThan(first_hit_impact_i)
      expect(first_hit_impact_i).toBeLessThan(hit_log_is[1])
      // mob-1's death line follows its OWN hit (order: hit → number → death), riding the death beat.
      expect(idx(tl, (e) => e.kind === 'beat' && e.anim === 'death' && e.id === 'mob-1')).toBeLessThan(
        idx(tl, (e) => e.kind === 'log' && e.prefix === 'death')
      )
    }
  )

  it(
    'a trap crossing: the "<owner>\'s trap hit <mob> for N" line lands AT the pause beat, between the walk and the\n' +
      'resume (trap fires → its line)',
    async () => {
      const fighters = new Map([
        ['p1', { name: 'Aldric' }],
        ['mob-0', { name: 'Cave Crab' }],
      ])
      const rig = make_rig(fighters)
      await play_move_mirror(rig, {
        entity_id: 'mob-0',
        trap_owner_id: 'p1',
        path: [
          { x: 8, y: 6 },
          { x: 7, y: 6 }, // the trap cell (index 1) — a RESUME leg follows
          { x: 6, y: 6 },
        ],
        trap_hits: [{ index: 1, cell: { x: 7, y: 6 }, damage: 15 }],
      })
      const tl = rig.timeline
      // exactly one trap line, and it reads the real chain damage.
      const trap = logs(tl).find((l) => l.prefix === 'trap')
      expect(trap.message).toBe("Aldric's trap hit Cave Crab for 15")
      // it lands AT the pause beat: after the walk ONTO the trap cell, before the RESUME walk leg.
      const trap_i = idx(tl, (e) => e.kind === 'log' && e.prefix === 'trap')
      const walk_is = tl.map((e, i) => (e.kind === 'walk' ? i : -1)).filter((i) => i >= 0)
      expect(trap_i).toBeGreaterThan(walk_is[0]) // after arriving at the trap cell
      expect(trap_i).toBeLessThan(walk_is.at(-1)) // before the resume leg
      // and the trap flinch beat precedes the line (it rides the beat, doesn't lead it).
      expect(idx(tl, (e) => e.kind === 'beat' && e.anim === 'hit')).toBeLessThan(trap_i)
      // STRICT INTERRUPTION: the second walk starts only after the trap beat's natural end. Awaiting the base
      // entity_beat promise would resume at `beat-impact`, on the same frame the damage number first appears.
      const trap_done_i = idx(tl, (e) => e.kind === 'beat-done' && e.anim === 'hit')
      expect(trap_done_i).toBeGreaterThan(idx(tl, (e) => e.kind === 'beat-impact' && e.anim === 'hit'))
      expect(trap_done_i).toBeLessThan(walk_is.at(-1))
    }
  )

  it(
    'the batch-flush signature is GONE: across a whole cast the log timestamps span multiple beat-gaps — a\n' +
      'synchronous dump would collapse them to ~one instant',
    async () => {
      const fighters = new Map([
        ['p1', { name: 'Aldric' }],
        ['mob-0', { name: 'Sewer Rat', dead: true }],
      ])
      const rig = make_rig(fighters)
      await play_cast_mirror(rig, {
        entity_id: 'p1',
        spell_id: 'dungeon_strike',
        effects: [{ target_id: 'mob-0', damage: 12, has_health: true, killed: true }],
        is_critical: false,
      })
      const ts = logs(rig.timeline).map((l) => l.t)
      const span = Math.max(...ts) - Math.min(...ts)
      // three beats (swing, flinch, death) separate the three lines — the span is at least two real gaps. A batch
      // flush (the old fight.js packet-handler emission) would put all three within a single synchronous frame.
      expect(span).toBeGreaterThanOrEqual(2 * TICK_MS)
    }
  )
})
