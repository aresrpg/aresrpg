// THE HEADLESS PLAY HARNESS — ACCEPTANCE PACK (night ladder item b). Every row is a requirement sentence made a
// named scenario over the ONE door `input(msg, now)` + the {kind, at, duration, payload} beat stream: the
// game is provable through anything that speaks the door protocol. EXTENDS the M1a suite
// (src/scenario_solo|coop, envelopes_7b) — no row duplicates an existing one.
import { describe, test, expect, mock } from 'bun:test'

import { evaluate_trace, envelope, JITTER_MS } from '../../../test/gold/specs_anchor/pacing_envelopes.ts'
import { build_turn_batch, subscribe_commit_due } from '../src/txs.js'
import { presenting, commit_due } from '../src/project.js'
import { local_intent_beats, synthetic_cast_events, MOB_TURN_MS } from '../src/present.js'
import { CAST_BEAT_MS } from '../src/fight_render_events.js'
import { FIGHT, ME, PEER, T0, ev, participant, mob, fight_object, active_store } from '../harness/fixtures.js'
import { trace_of } from '../harness/cli.js'

describe('AOE zone victims — the cross zone resolves correctly on-chain but was never rendered client-side', () => {
  // CROSS-1 at cell 45 covers center + arms {44, 46, 25, 65}. Three mobs stand INSIDE the zone on three
  // DISTINCT cells — the chain hits them all; the stream must carry one visible beat PER victim.
  const zone_fight = () => fight_object({ mobs: [mob(45), mob(44), mob(25)] })

  test('my CROSS-1 cast paints ONE damage floater PER zone victim in the local stream — three victims, three beats', () => {
    const store = active_store({ fight: zone_fight() })
    const beats = local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: 45,
        victims: [
          { is_mob: true, idx: 0, amount: 7, remaining_hp: 13 },
          { is_mob: true, idx: 1, amount: 7, remaining_hp: 13 },
          { is_mob: true, idx: 2, amount: 7, remaining_hp: 13 },
        ],
      }),
      { fight_id: FIGHT }
    )
    store
      .getState()
      .input(
        { type: 'intent', intent: { kind: 'cast', ap_cost: 5, damaging: true, target_cell: 45 }, beats },
        T0 + 1_000
      )
    const [local] = store.getState().wave.filter((t) => t.is_local)
    const floaters = local.beats.filter((b) => b.kind === 'damage')
    expect(floaters.map((b) => b.payload.target_id)).toEqual(['mob-0', 'mob-1', 'mob-2']) // one beat per victim
    for (let i = 1; i < floaters.length; i++) expect(floaters[i].at).toBeGreaterThan(floaters[i - 1].at) // serial, never merged
  })

  test('the receipt twin: a mob AOE cast over two seats folds BOTH victims and paces a per-victim floater each', () => {
    const store = active_store({
      fight: fight_object({ participants: [participant(ME, 21), participant(PEER, 22)] }),
    })
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            // one CROSS-1 cast at 21: me (21) + the peer (22, an arm cell) both inside the zone.
            // Authentic chain emitter order: effects BEFORE their Cast (fight_render_events contract).
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 1,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 60_000 }),
          ],
        },
        version: 3,
      },
      T0 + 5_000
    )
    const s = store.getState()
    expect(s.fighters.p0.hp).toBe(44) // the zone respected on-chain…
    expect(s.fighters.p1.hp).toBe(44)
    const [slot] = s.wave.filter((t) => !t.is_local)
    const floaters = slot.beats.filter((b) => b.kind === 'damage')
    expect(floaters.map((b) => b.payload.target_id)).toEqual([ME, PEER]) // …and VISUALIZED per victim
    const verdict = evaluate_trace(trace_of(s.wave, { t0: T0 }))
    expect(verdict.envelope_violations).toEqual([]) // E3 serial-floater law holds over this scenario's own stream
    expect(verdict.order_violations).toEqual([])
  })
})

describe('floater timing — §7b E2 (the "at least 1s late" gated complaint)', () => {
  test('VFX delivery → floater ≤ E2 max: the natural-branch stream pops the floater AT the clip impact, never a stretched offset', () => {
    const store = active_store()
    // one mob turn that FITS its 3s slot (raw 1400 + 350 < 3000 → the natural branch): the floater must start
    // exactly at the cast clip's real impact — the proportional-stretch class ("at least 1s late") reds here.
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 60_000 }),
          ],
        },
        version: 3,
      },
      T0 + 5_000
    )
    const s = store.getState()
    const [slot] = s.wave.filter((t) => !t.is_local)
    expect(slot.duration).toBe(MOB_TURN_MS)
    const cast = slot.beats.find((b) => b.kind === 'cast')
    const floater = slot.beats.find((b) => b.kind === 'damage')
    expect(floater.at - (cast.at + CAST_BEAT_MS)).toBe(0) // the floater pops AT the impact — zero added delay
    // the §7b machine twin agrees over this scenario's own stream (delivery lane at the natural clip impact):
    const verdict = evaluate_trace(trace_of(s.wave, { t0: T0, vfx: true }))
    const e2 = verdict.measures.filter((m) => m.key === 'E2')
    expect(e2.length).toBe(1) // measured, not silently skipped
    expect(e2[0].verdict).toBe('in')
    expect(e2[0].interval_ms).toBeLessThanOrEqual(envelope('E2').max_ms + JITTER_MS)
    expect(verdict.order_violations).toEqual([])
    expect(verdict.envelope_violations).toEqual([])
  })
})

describe('idle turn commits — a turn with zero staged actions still commits and triggers mob actions', () => {
  test('a turn with ZERO actions still raises commit_due at the deadline window and the edge submits ONCE', () => {
    const store = active_store() // deadline T0+30_000, ZERO staged drafts — an idle human turn
    const submit = mock(() => Promise.resolve())
    const stop = subscribe_commit_due(store, { submit })
    store.getState().input({ type: 'tick' }, T0 + 29_100) // past fire_at = deadline − 1s buffer
    expect(submit).toHaveBeenCalledTimes(1) // the idle pass fires — the SDK ships a bare act_pass, mobs act
    expect(commit_due(store.getState())).toBe(false) // the edge claimed busy synchronously (single-flight)
    stop()
  })

  test('…and the mob wave presents after the idle commit receipt', () => {
    const store = active_store()
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }), // my empty turn — committed in any case
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('MobMoved', { idx: 0, to_cell: 41 }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
          ],
        },
        version: 3,
      },
      T0 + 29_800
    )
    const s = store.getState()
    const remote = s.wave.filter((t) => !t.is_local)
    expect(remote.length).toBe(1)
    expect(remote[0].source_id).toBe('mob-0')
    expect(remote[0].duration).toBe(MOB_TURN_MS)
    expect(presenting(s)).toBe(true) // the mob wave presents — the idle commit triggered mob actions
    const verdict = evaluate_trace(trace_of(s.wave, { t0: T0 }))
    expect(verdict.envelope_violations).toEqual([])
    expect(verdict.dead_air_violations).toEqual([])
  })
})

describe('turn-bound drafts — a deadline/manual rollover makes a stale auto-flush structurally empty', () => {
  test('a legitimate fifth cast dies with its turn, so the late auto-flush attempts zero submissions', () => {
    const store = active_store()
    store.getState().input({
      type: 'stage',
      intent: { kind: 1, target: 45, spell_template_id: '0xspell', spell_key: 'strike' },
    })
    expect(build_turn_batch(store, (cell) => cell).batch).toHaveLength(1)

    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
          ],
        },
        version: 3,
      },
      T0 + 30_000
    )

    const submit = mock(() => {})
    const late_auto_flush = () => {
      const { batch } = build_turn_batch(store, (cell) => cell)
      if (batch.length) submit(batch)
    }
    late_auto_flush()

    expect(store.getState().staged, 'TurnEnded owns destruction of every draft from that turn').toEqual([])
    expect(submit, 'a stale deadline callback has no action left to submit').toHaveBeenCalledTimes(0)
  })
})

describe('min-turn floor NEVER eats a deadline commit — a commit must not be lost to the 3s toast with 0:01 left', () => {
  test('an end_turn arriving with <3s left on the chain deadline is ACCEPTED — the floor yields to the deadline', () => {
    // my turn OPENS with only 2.5s of chain clock left (the late playable edge — the exact 0:01 shape)
    const store = active_store({ deadline: T0 + 2_600 }) // turn_started_at = T0+100
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, T0 + 1_100) // 1.5s left < the 3s floor
    const s = store.getState()
    expect(s.pending_end_turn).toBe(null) // never parked under the floor
    expect(s.active).toBe(null) // the TurnEnded intent FOLDED — the commit is in the log
  })

  test('a far deadline still holds the floor (the anti-bot law is untouched)', () => {
    const store = active_store() // 30s of chain clock — a bot's instant pass stays blocked
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, T0 + 1_100)
    const s = store.getState()
    // playable edge stamped at the status-1 snapshot adoption (T0+10) — the floor anchors there
    expect(s.pending_end_turn?.ready_at).toBe(T0 + 10 + 3_000)
    expect(s.active).toBe('p0')
  })
})

describe('strict turn-replay sequencing — the fight-presentation row: full cast sequence in order, none merged, THEN the mob wave', () => {
  test("a peer's 3-cast turn presents every cast in event order — 3 distinct cast beats, ordered floaters — then the mob turn row", () => {
    const store = active_store({
      fight: fight_object({ participants: [participant(ME, 21), participant(PEER, 22)] }),
    })
    const hit = (n) =>
      ev('Hit', {
        victim_is_mob: true,
        victim_idx: 0,
        amount: 4,
        remaining_hp: 20 - 4 * n,
        caster_is_mob: false,
        caster_idx: 1,
      })
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 1 }),
            // authentic emitter order — each cast's effects precede their Cast event
            hit(1),
            ev('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 45 }),
            hit(2),
            ev('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 45 }),
            hit(3),
            ev('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 45 }),
            ev('TurnEnded', { is_mob: false, idx: 1 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('MobMoved', { idx: 0, to_cell: 41 }),
            ev('Hit', {
              victim_is_mob: false,
              victim_idx: 0,
              amount: 6,
              remaining_hp: 44,
              caster_is_mob: true,
              caster_idx: 0,
            }),
            ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 60_000 }),
          ],
        },
        version: 3,
      },
      T0 + 6_000
    )
    const s = store.getState()
    const rows = s.wave.filter((t) => !t.is_local)
    expect(rows.map((t) => t.source_id)).toEqual([PEER, 'mob-0']) // the peer's full replay THEN the mob wave
    expect(rows[0].seq).toBeLessThan(rows[1].seq)
    const sequence = rows[0].beats.filter((b) => ['cast', 'damage'].includes(b.kind))
    expect(sequence.map((b) => b.kind)).toEqual(['cast', 'damage', 'cast', 'damage', 'cast', 'damage']) // in order, none merged
    const casts = rows[0].beats.filter((b) => b.kind === 'cast')
    expect(casts.length).toBe(3)
    for (let i = 1; i < casts.length; i++) expect(casts[i].at).toBeGreaterThan(casts[i - 1].at) // three DISTINCT presentations
    expect(rows[0].beats.filter((b) => b.kind === 'damage').map((b) => b.payload.new_health)).toEqual([16, 12, 8]) // the ordered ledger
    expect(rows.every((t) => t.duration === MOB_TURN_MS)).toBe(true) // each non-local turn owns its tuned slot
    const verdict = evaluate_trace(trace_of(s.wave, { t0: T0 }))
    expect(verdict.order_violations).toEqual([])
    expect(verdict.dead_air_violations).toEqual([])
    expect(verdict.teleport_violations).toEqual([])
    expect(verdict.envelope_violations).toEqual([])
  })
})
