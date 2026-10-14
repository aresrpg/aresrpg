import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { FRAGMENT } from '../src/generated/claude_spell_fragment.js'
import { create_source, SOURCE_SHA256 } from '../src/generated/claude_spell_source.js'
import { spell_effect_timing } from '../src/spell_effect_recipe.ts'
import { claude_spell_game_shader } from '../src/claude_spell_shader.ts'

test('the approved source is preserved byte-for-byte and every original effect function remains', () => {
  const source = readFileSync(new URL('../../../seed/content/spell_effects/source.html', import.meta.url), 'utf8')
  expect(createHash('sha256').update(source).digest('hex')).toBe(SOURCE_SHA256)
  expect(source).toContain(FRAGMENT)
  const shader = claude_spell_game_shader()
  const helpers = FRAGMENT.slice(FRAGMENT.indexOf('float h1'), FRAGMENT.indexOf('void main'))
  expect(helpers.length).toBeGreaterThan(20000)
  // All helper formulas except the camera projection boundary are untouched.
  for (const line of helpers
    .split('\n')
    .filter(
      (line) =>
        ![
          'vec3 prj(',
          'vec3 spot(',
          'float spot_on(',
          'vec2 c = floor(g',
          'vec2 rc =',
          'float inb =',
          'col = mix(col, gc',
          'float area =',
        ].some((boundary) => line.includes(boundary))
    ))
    expect(shader).toContain(line)
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
