import logger from './logger.js'

const log = logger(import.meta)

export const SOUND = {
  LEVEL_UP: 'entity.player.levelup',
  EXPERIENCE_ORB: 'entity.experience_orb.pickup',
  FIREWORK_LARGE_BLAST: 'entity.firework_rocket.large_blast',
  ZOMBIE_VILLAGER_CONVERTED: 'entity.zombie_villager.converted',
}

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

export const write_sound = ({
  client,
  sound,
  x,
  y,
  z,
  pitch, // to ignore passing a player location
}) => {
  log.info({ sound, pseudo: client.username }, 'playing sound')
  client.write('named_sound_effect', {
    soundName: sound,
    x: x * 8,
    y: y * 8,
    z: z * 8,
  })
}
