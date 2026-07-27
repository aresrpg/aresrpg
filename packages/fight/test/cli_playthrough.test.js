// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE CLI IMAGE PROOF (acceptance-pack row 7): an ENTIRE fight played through a
// ~20-line pseudo-CLI loop — read the beat stream → print beat lines → answer with inputs. Nothing in the
// loop knows the game beyond the door protocol (`input(msg, now)`) and the projections: swap `print` for
// stdout and `chain` for the fullnode and this IS a playable client. Not a product — a passing test.
import { describe, test, expect } from 'bun:test'

import { settlement_request, is_my_turn, presenting } from '../src/project.js'
import { local_intent_beats, synthetic_cast_events } from '../src/present.js'
import { FIGHT, ME, T0, ev, active_store } from '../harness/fixtures.js'
import { beat_line, trace_of } from '../harness/cli.js'

// The §7b envelope twin is TRACKED in this repo (test/gold/specs_anchor/pacing_envelopes.ts) — it is
// the machine oracle of the core's own beat contract, not content-pipeline output, so it is imported
// unconditionally: a lost/renamed twin reds this suite instead of silently skipping it (#746).
const { evaluate_trace } = await import('../../../test/gold/specs_anchor/pacing_envelopes.ts')

// ── the player's script (what a human would click) and the chain's scripted answers ─────────────────────────
const strike = (amount, remaining_hp) => ({
  label: `cast strike → mob-0 (−${amount})`,
  input: {
    type: 'intent',
    intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 },
    beats: local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: 45,
        victims: [{ is_mob: true, idx: 0, amount, remaining_hp }],
      }),
      { fight_id: FIGHT, resolve_fighter_id: ({ is_mob, idx }) => (is_mob ? `mob-${idx}` : ME) }
    ),
  },
})
const end_turn = { label: 'end turn', input: { type: 'intent', intent: { kind: 'end_turn' } } }

const receipt = (version, events) => () => ({ type: 'receipt', version, receipt: { events } })
const turn_1 = receipt(3, [
  // my commit echoed (effects before their Cast — the authentic emitter order), then the mob's reply
  ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 0 }),
  ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
  ev('TurnEnded', { is_mob: false, idx: 0 }),
  ev('TurnStarted', { is_mob: true, idx: 0 }),
  ev('MobMoved', { idx: 0, to_cell: 41 }),
  ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
  ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
  ev('TurnEnded', { is_mob: true, idx: 0 }),
  ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
])
const turn_2 = receipt(4, [
  ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 12, remaining_hp: 0, caster_is_mob: false, caster_idx: 0 }),
  ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
  ev('Victory', {}),
])

/** THE PSEUDO-CLI LOOP — the whole client, one screenful: drain the stream, else settle, else act, else let
 *  the chain answer, else idle-tick (floor flush + reducer clock). */
const play = (store, { script, chain, print }) => {
  const trace = []
  let now = T0 + 500
  for (let guard = 0; guard < 60; guard++) {
    const s = store.getState()
    const [head] = s.wave
    const request = settlement_request(s)
    if (head) {
      trace.push(...trace_of([head], { t0: now }))
      for (const b of head.beats) if (beat_line(now, b)) print(beat_line(now, b))
      now += head.duration || 400
      store.getState().input({ type: 'presented', seq: head.seq }, now)
    } else if (request) {
      print(`> settle ${request.phase}: claim + OPEN the FightResult`)
      store.getState().input({ type: 'settlement_attempt', signal: request.signal }, now)
      store.getState().input({ type: 'settlement_outcome', signal: request.signal, verdict: 'opened' }, (now += 400))
    } else if (s.settlement?.attempt?.verdict === 'opened') {
      print('★ FightResult OPENED — session closed')
      return { closed: true, trace }
    } else if (
      is_my_turn(s) &&
      !presenting(s) &&
      !s.pending_end_turn &&
      !s.log.some((action) => action.source === 'intent' && action.kind === 'TurnEnded') &&
      script.length
    ) {
      const act = script.shift()
      print(`> ${act.label}`)
      store.getState().input(act.input, now)
    } else if (
      (!is_my_turn(s) || s.log.some((action) => action.source === 'intent' && action.kind === 'TurnEnded')) &&
      s.phase === 'active' &&
      chain.length
    ) {
      store.getState().input(chain.shift()(), (now += 600)) // the chain answers my committed turn
    } else {
      store.getState().input({ type: 'flush' }, (now += 500)) // idle: min-turn floor flush + the tick clock
      store.getState().input({ type: 'tick' }, now)
    }
  }
  return { closed: false, trace }
}

describe('the CLI image — the game is playable through anything that speaks the door protocol', () => {
  test('a full fight (2 turns → kill → victory → OPENED) drives to closure through the pseudo-CLI loop', () => {
    const lines = []
    const result = play(active_store(), {
      script: [strike(8, 12), end_turn, strike(12, 0), end_turn],
      chain: [turn_1, turn_2],
      print: (line) => lines.push(line),
    })
    expect(result.closed).toBe(true) // the loop terminated by CLOSING the session, not by its guard
    expect(lines.some((l) => l.includes(`${ME} casts strike`))).toBe(true) // my prediction painted
    expect(lines.some((l) => l.includes('mob-0 casts mob_attack_dungeon'))).toBe(true) // the mob wave replayed
    expect(lines.some((l) => l.includes('mob-0 takes 12 dmg → 0 hp'))).toBe(true) // the kill floater
    expect(lines.some((l) => l.includes('mob-0 dies'))).toBe(true) // from the damage beat's `killed` — no 'death' beat since #170 (5th)
    expect(lines.at(-1)).toBe('★ FightResult OPENED — session closed')
    // §7b conformance over everything this session PACED (the mob wave) — the CLI saw a legal stream:
    const verdict = evaluate_trace(result.trace)
    expect(verdict.order_violations).toEqual([])
    expect(verdict.dead_air_violations).toEqual([])
    expect(verdict.envelope_violations).toEqual([])
    // the acceptance read — the transcript IS the acceptance artifact:
    console.log(`\n${lines.join('\n')}\n`)
  })
})
