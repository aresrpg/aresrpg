import logger from './logger.js'

const log = logger(import.meta)

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

export const play_sound = ({
  client,
  sound,
  category = CATEGORY.MASTER,
  x,
  y,
  z,
  volume = 1,
}) => {
  log.info({ sound, pseudo: client.username }, 'playing named sound')
  client.write('named_sound_effect', {
    soundName: sound,
    soundCategory: category,
    x: x * 8,
    y: y * 8,
    z: z * 8,
    volume,
    pitch: 1,
  })
}
