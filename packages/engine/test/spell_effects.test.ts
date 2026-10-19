import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { create_source, SOURCE_SHA256 } from '../src/generated/claude_spell_source.js'
import { spell_effect_timing } from '../src/spell_effect_recipe.ts'
import { FRAGMENT as GAME_FRAGMENT } from '../src/generated/claude_spell_game_fragment.js'

import reference from './fixtures/spell_game_shader.json'
import { fragment as FRAGMENT } from './fixtures/claude_spell_fragment.json'

test('the approved source is preserved byte-for-byte and every original effect function remains', () => {
  const source = readFileSync(new URL('../../../seed/content/spell_effects/source.html', import.meta.url), 'utf8')
  expect(createHash('sha256').update(source).digest('hex')).toBe(SOURCE_SHA256)
  expect(source).toContain(FRAGMENT)
  expect(reference.source_sha256).toBe(SOURCE_SHA256)
  expect(GAME_FRAGMENT).not.toMatch(/aresGame|\bdummy\s*\(|\bbox\s*\(|\bin_area\s*\(|\buCam\b|\buLook\b|\buDum2\b/)
  const integrated = new Set(['prj', 'box', 'in_area', 'spot', 'spot_on', 'ground', 'dummy', 'main'])
  for (const match of FRAGMENT.matchAll(/^(?:float|vec[234]|void) (\w+)\([^{}]*\{/gm)) {
    if (integrated.has(match[1]!)) continue
    let end = match.index! + match[0].length
    let depth = 1
    while (depth > 0 && end < FRAGMENT.length) {
      depth += Number(FRAGMENT[end] === '{') - Number(FRAGMENT[end] === '}')
      end += 1
    }
    expect(depth).toBe(0)
    expect(GAME_FRAGMENT).toContain(FRAGMENT.slice(match.index, end))
  }
})

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
