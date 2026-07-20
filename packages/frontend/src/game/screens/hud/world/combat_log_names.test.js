// OWNER BUG regression: the combat log printed literal "Mob hit … for 9" — fight_bridge.js's build_fighters
// stamps `name: view.mob_names?.[m.template] || 'Mob'` for a mob whose template hasn't resolved yet
// (dungeon_store's `_resolve_mob_identities` is async fire-and-forget), and fight.js's emit_cast_log baked
// that placeholder into the segment's `text` at EMIT time — a line dispatched before the resolve landed kept
// "Mob" FOREVER (message_history only ever appends, chat.js). The fix: segments also carry `ref` (the
// fighter/participant id); resolve_segment_text re-resolves against the LIVE fighters map on every render, so
// a name that resolves after the line was emitted heals every past line automatically.

import { describe, expect, it } from 'bun:test'

import { resolve_segment_text } from './combat_log_names.js'

describe('resolve_segment_text', () => {
  it('THE BUG: a name segment emitted BEFORE the mob identity resolve renders the real name AFTER it resolves', () => {
    // the exact segment shape emit_cast_log dispatches for a caster whose mob identity hasn't resolved yet —
    // fight_bridge's build_fighters fallback baked literal 'Mob' into `text` at emit time.
    const seg = { text: 'Mob', cls: 'clog-name', ref: 'mob-0' }

    // moment 1: right after emit, fighters still holds the unresolved placeholder (or isn't even ticked yet).
    const fighters_before = new Map([['mob-0', { name: 'Mob' }]])
    expect(resolve_segment_text(seg, fighters_before)).toBe('Mob')

    // moment 2: dungeon_store's _resolve_mob_identities landed; fight_bridge's next sync_engine poll rebuilt
    // the fighters map (action/fight/sync) with the real template name. The SAME segment object — never
    // mutated, never re-emitted — must now render the real name.
    const fighters_after = new Map([['mob-0', { name: 'Sewer Rat' }]])
    expect(resolve_segment_text(seg, fighters_after)).toBe('Sewer Rat')

    // it must never re-degrade to the literal placeholder once healed, and must never be the string "Mob"
    // once a real name is live.
    expect(resolve_segment_text(seg, fighters_after)).not.toBe('Mob')
  })

  it('falls back to the emitted text once the fighter is gone (fight ended / id unknown) — never worse than before', () => {
    const seg = { text: 'Mob', cls: 'clog-name', ref: 'mob-0' }
    expect(resolve_segment_text(seg, undefined)).toBe('Mob')
    expect(resolve_segment_text(seg, new Map())).toBe('Mob')
  })

  it('a live fighter with an EMPTY name never wins over the emitted text', () => {
    const seg = { text: 'A fighter', cls: 'clog-name', ref: 'mob-0' }
    expect(resolve_segment_text(seg, new Map([['mob-0', { name: '' }]]))).toBe('A fighter')
  })

  it('ref-less segments (verbs / spell names / numbers) always render their own text, fighters map ignored', () => {
    const seg = { text: ' hit ', cls: 'clog-verb' }
    expect(resolve_segment_text(seg, new Map([['mob-0', { name: 'Sewer Rat' }]]))).toBe(' hit ')
  })

  it('mirrors the SAME resolution for a caster segment (players race the roster load too)', () => {
    const seg = { text: '0xabc…1234', cls: 'clog-name', ref: '0xabc' }
    const fighters = new Map([['0xabc', { name: 'Aldric' }]])
    expect(resolve_segment_text(seg, fighters)).toBe('Aldric')
  })
})
