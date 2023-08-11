export const CATEGORY = {
  MASTER: 0,
  MUSIC: 1,
  RECORDS: 2,
  WEATHER: 3,
  BLOCKS: 4,
  HOSTILE: 5,
  NEUTRAL: 6,
  PLAYERS: 7,
  AMBIENT: 8,
  VOICE: 9,
}

export const Sound = {
  SWITCH_SPELL: 'aresrpg:ui_spell_switch',
  SPELL_FAILED: 'aresrpg:ui_spell_failed',
}

export function play_sound({
  client,
  sound,
  category = CATEGORY.MASTER,
  x,
  y,
  z,
}) {
  client.write('named_sound_effect', {
    soundName: sound,
    soundCategory: category,
    x: x * 8,
    y: y * 8,
    z: z * 8,
    volume: 1,
    pitch: 1,
  })
}
