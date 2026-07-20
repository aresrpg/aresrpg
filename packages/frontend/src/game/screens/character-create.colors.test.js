// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Proves the creator's color-transition seam (a male/female switch in character
// creation must never reset the color). Root cause was structural: the sex toggle routed through
// select_class, whose class-arm re-derives the authored DEFAULT colors — wiping the player's picks. The
// palette has NO sex dimension (DEFAULT_COLORS is keyed by class id only), so preservation is verbatim —
// no index/nearest-match remap applies. Imports the REAL module (loads clean under DOM-less bun:test).
import { describe, expect, test } from 'bun:test'

import { transition_colors } from './character-create.js'

const PICKS = /** @type {[string,string,string]} */ (['#123456', '#abcdef', '#0f0f0f'])

describe('transition_colors — sex toggle preserves, class switch re-derives', () => {
  test('SEX toggle → the player picks survive verbatim (a real reported bug)', () => {
    expect(transition_colors({ kind: 'sex', class_id: 'senshi', current: PICKS })).toEqual(PICKS)
  })

  test('SEX toggle returns a COPY, never the same array (set_color mutates copies; aliasing would leak)', () => {
    const out = transition_colors({ kind: 'sex', class_id: 'yajin', current: PICKS })
    expect(out).toEqual(PICKS)
    expect(out).not.toBe(PICKS)
  })

  test('SEX toggle preserves even when the picks EQUAL the class defaults (no special-casing)', () => {
    const senshi_defaults = /** @type {[string,string,string]} */ (['#ffffff', '#d9af57', '#8b6539'])
    expect(transition_colors({ kind: 'sex', class_id: 'senshi', current: senshi_defaults })).toEqual(senshi_defaults)
  })

  test('CLASS switch → adopts the target class AUTHORED defaults (unchanged intended behavior)', () => {
    expect(transition_colors({ kind: 'class', class_id: 'senshi', current: PICKS })).toEqual([
      '#ffffff',
      '#d9af57',
      '#8b6539',
    ])
    expect(transition_colors({ kind: 'class', class_id: 'yajin', current: PICKS })).toEqual([
      '#1a237e',
      '#ffffff',
      '#ffd700',
    ])
  })

  test('CLASS switch to a class WITHOUT authored defaults → the neutral set (never the old picks)', () => {
    expect(transition_colors({ kind: 'class', class_id: 'iyashi', current: PICKS })).toEqual([
      '#d8b48a',
      '#9aa6b8',
      '#b23838',
    ])
  })
})
