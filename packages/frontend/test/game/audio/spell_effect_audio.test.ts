import { expect, test } from 'bun:test'
import { create_authored_spell_source } from '@aresrpg/engine'

import { spell_effect_audio_plan } from '../../../src/game/audio/spell_effect_audio.ts'
import { audio_src } from '../../../src/game/audio/audio_registry.ts'

test('all original sound plans survive verbatim, with every recording available', () => {
  const source = create_authored_spell_source()
  for (const [classe, rows] of Object.entries(source.catalog))
    for (const row of rows) {
      const preset = source.select(classe, row.name)
      const plan = spell_effect_audio_plan({ preset, areas: [], atlas_urls: [], triggered: false })
      expect(plan).toEqual(source.sound_plan().filter((event) => !preset.trap || event.step !== 2))
      for (const event of plan)
        if (event.name.startsWith('d:')) expect(audio_src(`spell_fx_${event.name.slice(2)}`)).not.toBeNull()
    }
})

test('trap placement defers the original impact plan until the real trigger', () => {
  const source = create_authored_spell_source(),
    preset = source.select('yajin', 'Mass Trap')
  const recipe = { preset, areas: [], atlas_urls: [], triggered: false }
  expect(spell_effect_audio_plan(recipe).every((event) => event.step !== 2)).toBeTrue()
  const triggered = spell_effect_audio_plan({ ...recipe, triggered: true })
  expect(triggered.every((event) => event.step === 2)).toBeTrue()
  expect(triggered.some((event) => event.name === 'd:lakam_409' && Math.abs(event.t) < 0.0001)).toBeTrue()
})
