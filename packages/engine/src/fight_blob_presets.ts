// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Visual SSOT for semantic fight-board paint. Callers submit cells and meaning, never renderer tuning.

import type { FightBlobSpec } from './types.ts'

export type FightBlobPreset =
  | 'start_a'
  | 'start_b'
  | 'movement_range'
  | 'movement_preview'
  | 'movement_path'
  | 'spell_range'
  | 'spell_targetable'
  | 'spell_hover'
  | 'glyph'
  | 'trap'

type FightBlobFacts = Readonly<{
  cells: readonly number[]
  origin_cell?: number
  animate?: boolean
}>

const PRESETS: Readonly<Record<FightBlobPreset, Omit<FightBlobSpec, 'cells' | 'origin_cell'>>> = Object.freeze({
  start_a: Object.freeze({ shape: 'per_cell', color: 0x2f6bd8, priority: 2, reveal_step_ms: 35 }),
  start_b: Object.freeze({ shape: 'per_cell', color: 0xff7a2c, priority: 2, reveal_step_ms: 35 }),
  movement_range: Object.freeze({
    shape: 'per_cell',
    color: 0x55b979,
    priority: 0,
    opacity: 0.75,
    reveal_step_ms: 15,
    animate_updates: false,
  }),
  movement_preview: Object.freeze({
    shape: 'per_cell',
    color: 0x55b979,
    priority: 0,
    opacity: 0.6,
    reveal_step_ms: 15,
  }),
  movement_path: Object.freeze({
    shape: 'per_cell',
    color: 0x176b3a,
    priority: 1,
    opacity: 0.9,
    reveal_step_ms: 10,
    animate: false,
  }),
  spell_range: Object.freeze({ shape: 'per_cell', color: 0x67b7ed, priority: 0, opacity: 0.56, reveal_step_ms: 15 }),
  spell_targetable: Object.freeze({
    shape: 'per_cell',
    color: 0x185ca8,
    priority: 1,
    opacity: 0.82,
    reveal_step_ms: 15,
    animate_updates: false,
  }),
  spell_hover: Object.freeze({
    shape: 'single',
    color: 0xd73545,
    priority: 2,
    opacity: 0.92,
    reveal_step_ms: 0,
    animate: false,
  }),
  glyph: Object.freeze({ shape: 'single', color: 0xe0791e, priority: 2, opacity: 0.78, animate: false }),
  trap: Object.freeze({
    shape: 'per_cell',
    color: 0x14110b,
    priority: 3,
    opacity: 0.95,
    animate: false,
    decoration: 'trap',
  }),
})

export const fight_blob_preset = (preset: FightBlobPreset, facts: FightBlobFacts): FightBlobSpec =>
  Object.freeze({ ...PRESETS[preset], ...facts })
