// D111 — battle music fires at ACTIVE, never at placement/board-mount. Unit coverage of the pure derivation
// (fight-engine/combat_music.js `combat_music_active`) the combat-music listener drives. The live wiring (the
// listener fires this on action/fight_mode + every placement-flipping action) is exercised end-to-end by the
// headed dungeon runs; this proves the derivation exhaustively: the ONLY state that plays the battle bed is a
// live, past-placement fight.
import { describe, expect, it } from 'bun:test'

import { combat_music_active } from './combat_music.js'

describe('D111 combat_music_active — battle bed only when a fight is LIVE (past placement)', () => {
  it('PLACEMENT (board just mounted) → NO battle music (roam/arctic bed keeps playing)', () => {
    // the exact dungeon symptom: sync_engine dispatches fight_mode=true at the placement spawn (placement:true).
    expect(combat_music_active({ fight_mode: true, fight: { placement: true } })).toBe(false)
  })

  it('ACTIVE (placement flipped false) → battle music ON', () => {
    // the PLACEMENT→ACTIVE flip clears placement (dungeon reconcile / WS action/fight/started) — battle bed in.
    expect(combat_music_active({ fight_mode: true, fight: { placement: false } })).toBe(true)
  })

  it('a WS/dungeon fight with no placement flag at all + fight_mode → battle music ON (a started slice)', () => {
    expect(combat_music_active({ fight_mode: true, fight: {} })).toBe(true)
  })

  it('fight_mode but NO slice yet (spawn not folded) → NO battle music (nothing live)', () => {
    expect(combat_music_active({ fight_mode: true, fight: null })).toBe(false)
  })

  it('a live ACTIVE slice but fight_mode already torn down (exit) → NO battle music', () => {
    expect(combat_music_active({ fight_mode: false, fight: { placement: false } })).toBe(false)
  })

  it('the empty/roam state → NO battle music', () => {
    expect(combat_music_active({})).toBe(false)
    expect(combat_music_active(null)).toBe(false)
  })
})
