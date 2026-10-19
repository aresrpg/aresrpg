import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { create_source } from '../src/generated/claude_spell_source.js'
import { spell_effect_timing } from '../src/spell_effect_recipe.ts'
test('worker synthesis retains the complete authored DSP program', () => {
  const source = readFileSync(new URL('../../../seed/content/spell_effects/synth.js', import.meta.url), 'utf8')
  const extracted = readFileSync(new URL('../src/generated/claude_spell_synth.js', import.meta.url), 'utf8')
  expect(extracted).toContain(source)
})

test('all 240 presets retain original three-stage clocks and sound plans', () => {
  const source = create_source()
  expect(Object.values(source.catalog).flat()).toHaveLength(240)
  for (const [classe, rows] of Object.entries(source.catalog))
    for (const row of rows) {
      const preset = source.select(classe, row.name)
      const timing = spell_effect_timing({ preset, areas: [], atlas_urls: [], triggered: false }, 10 / 24)
      expect(timing.release_seconds).toBe(preset.cast)
      expect(source.frame(preset.cast * 0.5, 320, 224).uS).toBeCloseTo(0.5)
      expect(source.frame(preset.cast + preset.fly * 0.5, 320, 224).uTr).toBeCloseTo(0.5)
      const impact = preset.cast + preset.fly + (preset.trap ? source.trap_wait : 0)
      expect(source.frame(impact + 0.2, 320, 224).uI).toBeCloseTo(0.2 * source.impact_speed)
      if (!preset.trap) {
        expect(timing.end_seconds).toBeCloseTo(impact + source.hold)
        expect(source.frame(timing.end_seconds, 320, 224).uI).toBe(-1)
      }
      expect(source.sound_plan().length).toBeGreaterThan(0)
    }
})
