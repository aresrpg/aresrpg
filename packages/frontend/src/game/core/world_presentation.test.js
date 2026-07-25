// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #812 — a hack-mode flip must reach every HUD surface LIVE (no page reload). The mechanism is the reducer
// door: embed_voxel.js publishes `world_presentation` on every session (re)boot (asserted in
// HackRadioPlayer.test.jsx, which owns the publish + fold contract) and each surface SELECTS it. This file
// owns the two things that door does not: the selector itself, and the PROVENANCE of its consumers — a
// surface that reads the preference module (resolve_hack_mode) instead re-branches only when React remounts
// it, i.e. after a reload, which is exactly the reported bug. End-to-end behaviour: e2e/hack_live_swap.spec.ts.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { select_hack_presentation } from './world_presentation.js'
import player_module from './modules/player.js'

const read = (/** @type {string} */ relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('the world-presentation signal', () => {
  test('the selector reads the mode the reducer door actually published', () => {
    const { reduce } = player_module()
    const fold = (/** @type {unknown} */ payload) =>
      select_hack_presentation(
        /** @type {any} */ (reduce(/** @type {any} */ ({}), /** @type {any} */ ({ type: 'action/world_presentation', payload }))) // prettier-ignore
      )
    expect(fold('hackgrid')).toBe(true)
    expect(fold('terrain')).toBe(false)
    expect(fold(undefined)).toBe(false) // a torn-down session folds back to terrain — never a sticky grid
    expect(select_hack_presentation(/** @type {any} */ ({}))).toBe(false) // pre-boot state, before any publish
  })

  test('every HUD surface that branches on hack mode selects the signal — never a second preference read', () => {
    for (const path of [
      '../screens/hud/use_minimap.js',
      '../screens/hud/MinimapModal.jsx',
      '../screens/hud/world/HackRadioPlayer.jsx',
    ]) {
      const source = read(path)
      expect(source.includes('select_hack_presentation'), `${path} selects the reducer-door signal`).toBe(true)
      expect(source.includes('resolve_hack_mode'), `${path} re-reads the preference module`).toBe(false)
    }
  })
})
