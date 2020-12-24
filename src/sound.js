export const sound_category = {
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

export const sound_stop_flags = {
  SOURCE: 0b01,
  SOUND: 0b10,
}

export function write_named_sound_effect(
  client,
  { soundName, soundCategory, position: { x, y, z }, volume, pitch }
) {
  client.write('named_sound_effect', {
    soundName,
    soundCategory,
    x: x * 8,
    y: y * 8,
    z: z * 8,
    volume,
    pitch,
  })
}

export function write_sound_effect(
  client,
  { soundId, soundCategory, position: { x, y, z }, volume, pitch }
) {
  client.write('sound_effect', {
    soundId,
    soundCategory,
    x: x * 8,
    y: y * 8,
    z: z * 8,
    volume,
    pitch,
  })
}

export function write_entity_sound_effect(
  client,
  { soundId, soundCategory, entityId, volume, pitch }
) {
  client.write('entity_sound_effect', {
    soundId,
    soundCategory,
    entityId,
    volume,
    pitch,
  })
}

export function write_stop_sound(client, { sourceId, sound }) {
  let flags = 0
  if (sourceId) flags |= sound_stop_flags.SOURCE
  if (sound) flags |= sound_stop_flags.SOUND
  client.write('stop_sound', {
    flags,
    sourceId,
    sound,
  })
}
