// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OWNER BUG: the combat log printed literal "Mob hit … for 9" instead of the real mob template name.
// Root cause: fight_bridge.js's build_fighters stamps `name: view.mob_names?.[m.template] || 'Mob'` for a mob
// whose template hasn't resolved yet (dungeon_store's `_resolve_mob_identities` is async fire-and-forget), and
// emit_cast_log/emit_deaths (below) baked that placeholder verbatim into the segment's `text` at EMIT time —
// a line dispatched before the resolve landed kept "Mob" FOREVER (message_history only ever appends).
//
// Fix: every caster/target/death name segment also carries `ref: <fighter id>` (LogSegment). This suite locks
// the COMPOSER's half of the contract (ref always matches the entity id the name was read for); the RENDERER's
// half — resolve_segment_text healing a stale segment once the live fighters map resolves — is covered by
// combat_log_names.test.js (co-located with WorldChat.jsx). The cross-import below proves the two halves
// compose end-to-end without wiring fight.js and WorldChat.jsx together in production code.

import { describe, expect, it } from 'bun:test'

import { emit_cast_log, emit_deaths, emit_death_line, emit_trap_line } from './fight.js'
import { resolve_segment_text } from '../../screens/hud/world/combat_log_names.js'

/** A fake dispatch that records every action, plus a lookup by id_prefix (combat_log_line's `id` is
 *  `${id_prefix}-N`) so a test can grab e.g. the 'hit' line without caring about dispatch order. */
const recorder = () => {
  const actions = []
  return { actions, dispatch: (type, payload) => actions.push({ type, payload }) }
}

const find_by_prefix = (actions, prefix) => actions.find((a) => a.payload.id.startsWith(`${prefix}-`))?.payload

describe('emit_cast_log — combat-log composer attaches a live ref to every name segment', () => {
  it('a hit on a mob whose identity has NOT resolved yet: text is the "Mob" placeholder, ref is the real fighter id', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Mob' }], // unresolved — fight_bridge's literal placeholder
    ])
    const get_state = () => ({ fight: { fighters } })
    const { actions, dispatch } = recorder()

    emit_cast_log(get_state, dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', damage: 9, heal: 0, has_health: true }],
      is_critical: false,
    })

    const hit = find_by_prefix(actions, 'hit')
    expect(hit).toBeTruthy()
    expect(hit.message).toBe('Aldric hit Mob for 9') // reproduces the exact reported bug text at emit time

    const caster_seg = hit.segments.find((s) => s.cls === 'clog-name')
    const target_seg = hit.segments.find((s) => s.cls === 'clog-target')
    expect(caster_seg).toEqual({ text: 'Aldric', cls: 'clog-name', ref: 'p1' })
    expect(target_seg).toEqual({ text: 'Mob', cls: 'clog-target', ref: 'mob-0' })

    // END-TO-END: once the identity resolve lands and the fighters map is rebuilt (fight_bridge's
    // action/fight/sync — untouched here), the SAME dispatched segment heals at render time.
    const fighters_after = new Map([...fighters, ['mob-0', { name: 'Sewer Rat' }]])
    expect(resolve_segment_text(target_seg, fighters_after)).toBe('Sewer Rat')
    expect(resolve_segment_text(target_seg, fighters_after)).not.toBe('Mob')
  })

  it('the cast context line ("<caster> cast <spell>") also carries the caster ref', () => {
    const fighters = new Map([['mob-0', { name: 'Mob' }]])
    const get_state = () => ({ fight: { fighters } })
    const { actions, dispatch } = recorder()

    emit_cast_log(get_state, dispatch, {
      entity_id: 'mob-0',
      spell_id: 'mob_attack_dungeon',
      effects: [],
      is_critical: false,
    })

    const cast = find_by_prefix(actions, 'cast')
    const caster_seg = cast.segments.find((s) => s.cls === 'clog-name')
    expect(caster_seg.ref).toBe('mob-0')
  })

  it('no-ops when the fight slice is gone (unchanged guard)', () => {
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: null }), dispatch, {
      entity_id: 'p1',
      spell_id: 'x',
      effects: [],
      is_critical: false,
    })
    expect(actions).toHaveLength(0)
  })
})

describe('emit_deaths — death line also carries a live ref', () => {
  it('a killed mob whose identity has not resolved yet: ref lets the renderer heal it later', () => {
    const fighters = new Map([['mob-0', { name: 'Mob', dead: false }]])
    const get_state = () => ({ fight: { fighters } })
    const { actions, dispatch } = recorder()

    emit_deaths(get_state, dispatch, [{ target_id: 'mob-0', killed: true }])

    const death = find_by_prefix(actions, 'death')
    expect(death.segments[0]).toEqual({ text: 'Mob', cls: 'clog-name', ref: 'mob-0' })

    const fighters_after = new Map([['mob-0', { name: 'Sewer Rat', dead: true }]])
    expect(resolve_segment_text(death.segments[0], fighters_after)).toBe('Sewer Rat')
  })

  it('an already-dead target is never announced twice', () => {
    const fighters = new Map([['mob-0', { name: 'Sewer Rat', dead: true }]])
    const { actions, dispatch } = recorder()
    emit_deaths(() => ({ fight: { fighters } }), dispatch, [{ target_id: 'mob-0', killed: true }])
    expect(actions).toHaveLength(0)
  })

  it('OWNER COLOUR GRAMMAR (07-12): "died" keeps its damage-red weight — the connective text after the name\n' +
    'segment must render clog-death, NOT the generic clog-verb fallback every other line type uses', () => {
    const fighters = new Map([['p1', { name: 'Aldric', dead: false }]])
    const { actions, dispatch } = recorder()
    emit_deaths(() => ({ fight: { fighters } }), dispatch, [{ target_id: 'p1', killed: true }])
    const death = find_by_prefix(actions, 'death')
    expect(death.message).toBe('Aldric died')
    expect(death.segments).toEqual([
      { text: 'Aldric', cls: 'clog-name', ref: 'p1' },
      { text: ' died', cls: 'clog-death' },
    ])
  })
})

describe('OWNER COLOUR GRAMMAR (07-12) — segment classes match the requested grammar', () => {
  it('damage numbers are clog-num (RED) — a plain hit', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', damage: 9, heal: 0, has_health: true }],
      is_critical: false,
    })
    const hit = find_by_prefix(actions, 'hit')
    expect(hit.message).toBe('Aldric hit Sewer Rat for 9')
    expect(hit.segments).toEqual([
      { text: 'Aldric', cls: 'clog-name', ref: 'p1' },
      { text: ' hit ', cls: 'clog-verb' },
      { text: 'Sewer Rat', cls: 'clog-target', ref: 'mob-0' },
      { text: ' for ', cls: 'clog-verb' },
      { text: '9', cls: 'clog-num' },
    ])
  })

  it('a critical hit prefixes CRIT! and upgrades the number to clog-num--crit', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', damage: 40, heal: 0, has_health: true }],
      is_critical: true,
    })
    const crit = find_by_prefix(actions, 'crit')
    expect(crit.message).toBe('CRIT! Aldric hit Sewer Rat for 40')
    expect(crit.segments[0]).toEqual({ text: 'CRIT! ', cls: 'clog-num clog-num--crit' })
    expect(crit.segments.at(-1)).toEqual({ text: '40', cls: 'clog-num clog-num--crit' })
  })

  it('heal numbers are clog-num--heal (PINK, not the old green) — +N stays inside the coloured span', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['p2', { name: 'Elena' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'guardian_mend',
      effects: [{ target_id: 'p2', damage: 0, heal: 20, has_health: true }],
      is_critical: false,
    })
    const heal = find_by_prefix(actions, 'heal')
    expect(heal.message).toBe('Aldric healed Elena for +20')
    expect(heal.segments).toContainEqual({ text: '+20', cls: 'clog-num clog-num--heal' })
  })

  it('a caster healing ITSELF (identical caster/target id+name) still emits two distinct, correctly-ref\'d\n' +
    'segments — proves the template splitter disambiguates repeated identical text by cursor position', () => {
    const fighters = new Map([['p1', { name: 'Aldric' }]])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'guardian_mend',
      effects: [{ target_id: 'p1', damage: 0, heal: 15, has_health: true }],
      is_critical: false,
    })
    const heal = find_by_prefix(actions, 'heal')
    const names = heal.segments.filter((s) => s.text === 'Aldric')
    expect(names).toHaveLength(2)
    expect(names[0]).toEqual({ text: 'Aldric', cls: 'clog-name', ref: 'p1' })
    expect(names[1]).toEqual({ text: 'Aldric', cls: 'clog-target', ref: 'p1' })
  })

  it('AP drain (composer-ready, unwired): effect.ap_loss renders a BLUE clog-num--ap number', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', ap_loss: 3 }],
      is_critical: false,
    })
    const drain = find_by_prefix(actions, 'ap-drain')
    expect(drain.message).toBe('Aldric drained 3 AP from Sewer Rat')
    expect(drain.segments).toContainEqual({ text: '3', cls: 'clog-num clog-num--ap' })
  })

  it('MP drain (composer-ready, unwired): effect.mp_loss renders a GREEN clog-num--mp number', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', mp_loss: 2 }],
      is_critical: false,
    })
    const drain = find_by_prefix(actions, 'mp-drain')
    expect(drain.message).toBe('Aldric drained 2 MP from Sewer Rat')
    expect(drain.segments).toContainEqual({ text: '2', cls: 'clog-num clog-num--mp' })
  })

  it('an effect with no damage/heal/ap_loss/mp_loss but has_health still falls through to the muted absorb line\n' +
    '(regression guard: the two new drain branches must not steal absorb\'s fallthrough)', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_cast_log(() => ({ fight: { fighters } }), dispatch, {
      entity_id: 'p1',
      spell_id: 'dungeon_strike',
      effects: [{ target_id: 'mob-0', damage: 0, heal: 0, has_health: true }],
      is_critical: false,
    })
    const absorb = find_by_prefix(actions, 'absorb')
    expect(absorb.message).toBe('Aldric hit Sewer Rat but dealt no damage')
  })
})

// COMBAT-LOG REALTIME: the log lines moved from a batch flush (fight.js packet handler) to
// per-beat emission inside voxel_fight_adapter. The adapter fires emit_death_line AT the death beat — by which
// point the fold has ALREADY flipped the slice `dead`. emit_death_line MUST therefore be UNCONDITIONAL (no
// pre-fold dead-check), unlike emit_deaths which keeps its batch dedup. This locks that split so a future refactor
// can't re-add a dead-check to emit_death_line and silently swallow every real-time death line.
describe('emit_death_line — UNCONDITIONAL (the per-beat emitter the adapter calls post-fold)', () => {
  it('announces a target the fold already marked dead (emit_deaths would skip it — that is the whole point)', () => {
    const fighters = new Map([['mob-0', { name: 'Sewer Rat', dead: true }]])
    const { actions, dispatch } = recorder()
    emit_death_line(() => ({ fight: { fighters } }), dispatch, { target_id: 'mob-0' })
    const death = find_by_prefix(actions, 'death')
    expect(death.message).toBe('Sewer Rat died')
    expect(death.segments).toEqual([
      { text: 'Sewer Rat', cls: 'clog-name', ref: 'mob-0' },
      { text: ' died', cls: 'clog-death' },
    ])
  })

  it('no fight slice → no throw, no line', () => {
    const { actions, dispatch } = recorder()
    emit_death_line(() => ({ fight: null }), dispatch, { target_id: 'mob-0' })
    expect(actions).toHaveLength(0)
  })
})

describe('emit_trap_line — trap damage names its owner or uses the neutral fallback', () => {
  it("composes \"<owner>'s trap hit <victim> for N\" with live owner/target refs", () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Sewer Rat' }],
    ])
    const { actions, dispatch } = recorder()
    emit_trap_line(() => ({ fight: { fighters } }), dispatch, {
      owner_id: 'p1',
      target_id: 'mob-0',
      damage: 15,
    })
    const trap = find_by_prefix(actions, 'trap')
    expect(trap.message).toBe("Aldric's trap hit Sewer Rat for 15")
    expect(trap.segments).toContainEqual({ text: 'Aldric', cls: 'clog-name', ref: 'p1' })
    expect(trap.segments).toContainEqual({ text: 'Sewer Rat', cls: 'clog-target', ref: 'mob-0' })
    expect(trap.segments).toContainEqual({ text: '15', cls: 'clog-num' })
  })

  it('an unknown owner is neutral: the victim is never rendered as the attacker', () => {
    const fighters = new Map([['mob-0', { name: 'Sewer Rat' }]])
    const { actions, dispatch } = recorder()
    emit_trap_line(() => ({ fight: { fighters } }), dispatch, {
      owner_id: null,
      target_id: 'mob-0',
      damage: 9,
    })
    const trap = find_by_prefix(actions, 'trap')
    expect(trap.message).toBe('A trap hit Sewer Rat for 9')
    expect(trap.segments.some((segment) => segment.cls === 'clog-name')).toBe(false)
    expect(trap.segments).toContainEqual({ text: 'Sewer Rat', cls: 'clog-target', ref: 'mob-0' })
  })

  it('an unresolved mob name emits the "Mob" placeholder but the ref heals it once the identity lands', () => {
    const fighters = new Map([
      ['p1', { name: 'Aldric' }],
      ['mob-0', { name: 'Mob' }],
    ])
    const { actions, dispatch } = recorder()
    emit_trap_line(() => ({ fight: { fighters } }), dispatch, {
      owner_id: 'p1',
      target_id: 'mob-0',
      damage: 9,
    })
    const trap = find_by_prefix(actions, 'trap')
    const target_seg = trap.segments.find((s) => s.cls === 'clog-target')
    expect(target_seg).toEqual({ text: 'Mob', cls: 'clog-target', ref: 'mob-0' })
    expect(resolve_segment_text(target_seg, new Map([['mob-0', { name: 'Cave Crab' }]]))).toBe('Cave Crab')
  })
})
