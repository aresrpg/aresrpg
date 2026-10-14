import { create_character_source, create_fight_state, project_board_cells } from '@aresrpg/fight'

import { character_icon } from '../../src/content/assets.ts'
import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import { load_character_model_urls } from '../../src/content/character_models.ts'
import { resolve_spell_effect } from '../../src/game/fight/spell_effect_recipe.ts'
import { create_spell_effect_probe } from '../../../engine/test/browser_spell_effects.ts'
import { spell_audio } from '../../src/game/audio/spell_effect_audio.ts'
import { audio_src } from '../../src/game/audio/audio_registry.ts'
import { create_fight_audio_observer } from '../../src/game/audio/fight_audio.ts'
import catalog from '../../../engine/src/generated/claude_spell_catalog.json'
import sounds from '../../../../seed/content/audio.json'
import { spell_effect_atlases } from '../../src/content/spell_effect_assets.ts'
import { create_spell_fidelity_probe } from '../../../engine/test/browser_spell_fidelity.ts'
const probe = await create_spell_effect_probe(document.querySelector('canvas')!)
const classes = document.getElementById('class') as HTMLSelectElement
const spells = document.getElementById('spell') as HTMLSelectElement
classes.innerHTML = Object.keys(catalog)
  .map((classe) => `<option>${classe}</option>`)
  .join('')
const choose = async (classe: string, name: string, male = true) => {
  classes.value = classe
  spells.innerHTML = catalog[classe as keyof typeof catalog]
    .map((row) => row.name)
    .map((name) => `<option>${name}</option>`)
    .join('')
  spells.value = name
  const state = create_fight_state({
    fight_id: 'effects',
    board_seed: 1n,
    players: [
      {
        character: 'hero',
        owner: 'owner',
        ready: true,
        hp: 100n,
        source: create_character_source({ classe, level: 200n }),
      },
    ],
    mobs: [],
    spells: catalog_spell_sources(),
  })
  const target = project_board_cells(state.contract.board).find((row) => row.kind === 'floor')!.cell
  const event = {
    type: 'spell_cast' as const,
    payload: {
      caster: 0n,
      spell: name,
      target_cell: target,
      cast_level: 1n,
      slot: 0n,
      ap_cost: 3n,
      critical: false,
      weapon: false,
    },
  }
  const effect = resolve_spell_effect(state, event)!
  const { body_url, hair_url } = await load_character_model_urls(classe, male)
  return probe.choose(
    {
      id: `${classe}:${name}`,
      type: 'cast',
      caster_id: 'hero',
      spell: name,
      cast_level: 1,
      target_cell: 43,
      element: effect.preset.el,
      style: effect.preset.trap ? 'trap' : 'damage',
      critical: false,
      amount: 30,
      target_max_hp: 100,
      affected_cells: [43],
      killed: false,
      effect,
    },
    { body_url: body_url!, hair_url, colors: ['#6eafb9', '#fff8e3', '#8c7055'], worn: { head: null, back: null } }
  )
}
const audio = create_fight_audio_observer()
const play = async () => {
  await choose(classes.value, spells.value)
  const { cue } = probe.snapshot()
  if (cue && (document.getElementById('sound') as HTMLInputElement).checked) {
    await spell_audio.prepare()
    audio.observe(cue, 'start', {})
  }
  probe.play()
}
classes.onchange = () => {
  spells.innerHTML = catalog[classes.value as keyof typeof catalog]
    .map((row) => row.name)
    .map((name) => `<option>${name}</option>`)
    .join('')
  void play()
}
spells.onchange = () => void play()
document.getElementById('play')!.onclick = () => void play()
const exposed = {
  ...probe,
  cancel_sound: audio.dispose,
  play_sound: async () => {
    const cue = probe.snapshot().cue!
    await audio.prepare(cue)
    audio.observe(cue, 'start', {})
  },
  fidelity: await create_spell_fidelity_probe(spell_effect_atlases()),
  choose,
  classes: catalog,
  portrait_url: character_icon,
  sound_sources: Object.keys(sounds.sounds)
    .filter((key) => key.startsWith('spell_fx_'))
    .flatMap((key) => {
      const url = audio_src(key)
      return url ? [url] : []
    }),
}
await choose('yogan', 'Magic Arrow')
Reflect.set(window, 'spell_probe', exposed)
declare global {
  interface Window {
    spell_probe: typeof exposed
  }
}
