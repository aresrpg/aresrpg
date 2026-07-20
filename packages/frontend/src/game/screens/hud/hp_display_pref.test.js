// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// hp_display_pref unit test (the HP gem's percent-vs-stacked mode must survive a reload).
// The module is pure localStorage (quality_pref idiom), so the toggle → persist → fresh-mount-read loop is
// tested at the module seam: GameWorldHud's Vitals hydrates via `useState(() => get_saved_hp_display() ===
// 'fraction')`, so "a fresh mount reads the saved mode" ≡ get_saved_hp_display returning what was saved.
// (Mounting the component itself is off the table under bun:test — importing GameWorldHud pulls the enoki
// wallet chain, which touches `window` at module load; the deck-key-arm split documented the same wall.)
// bun:test has no DOM localStorage — a minimal in-memory shim stands in, restored after the suite.

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { HP_DISPLAY_STORAGE_KEY, get_saved_hp_display, save_hp_display } from './hp_display_pref.js'

const store = new Map()
const real = globalThis.localStorage
globalThis.localStorage = /** @type {any} */ ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
})
afterAll(() => {
  if (real === undefined) delete globalThis.localStorage
  else globalThis.localStorage = real
})

describe('hp_display_pref — toggle → persisted → fresh mount reads it', () => {
  beforeEach(() => store.clear())

  it('defaults to STACKED NUMBERS (HP HUD defaults to numbers) when nothing is saved', () => {
    expect(get_saved_hp_display()).toBe('fraction')
  })

  it('a toggle to stacked persists and a fresh read (≡ fresh Vitals mount) hydrates it', () => {
    save_hp_display('fraction') // the gem click: percent → stacked
    expect(store.get(HP_DISPLAY_STORAGE_KEY)).toBe('fraction') // persisted under the plain key
    expect(get_saved_hp_display()).toBe('fraction') // fresh mount reads stacked
    save_hp_display('percent') // toggle back
    expect(get_saved_hp_display()).toBe('percent')
  })

  it('garbage in storage falls back to the numbers default, never leaks into state', () => {
    store.set(HP_DISPLAY_STORAGE_KEY, 'banana')
    expect(get_saved_hp_display()).toBe('fraction')
  })
})
