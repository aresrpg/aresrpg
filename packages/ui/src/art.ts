import slot_weapon from './assets/slot_weapon.png'
import slot_tool from './assets/slot_tool.png'
import slot_hat from './assets/slot_hat.png'
import slot_cloak from './assets/slot_cloak.png'
import slot_amulet from './assets/slot_amulet.png'
import slot_belt from './assets/slot_belt.png'
import slot_ring from './assets/slot_ring.png'
import slot_boots from './assets/slot_boots.png'
import slot_title from './assets/slot_title.png'
import slot_pet from './assets/slot_pet.png'
import slot_relic from './assets/slot_relic.png'
import stat_strength from './assets/stat_strength.png'
import stat_intelligence from './assets/stat_intelligence.png'
import stat_chance from './assets/stat_chance.png'
import stat_agility from './assets/stat_agility.png'
import stat_wisdom from './assets/stat_wisdom.png'
import health from './assets/health_heart.png'
import action from './assets/action_star.png'
import movement from './assets/movement_diamond.png'

export const stat_art = Object.freeze({
  vitality: health,
  health,
  action,
  movement,
  strength: stat_strength,
  intelligence: stat_intelligence,
  chance: stat_chance,
  agility: stat_agility,
  wisdom: stat_wisdom,
})
export const slot_art: Readonly<Record<string, string>> = Object.freeze({
  weapon: slot_weapon,
  tool: slot_tool,
  hat: slot_hat,
  cloak: slot_cloak,
  amulet: slot_amulet,
  belt: slot_belt,
  ring: slot_ring,
  boots: slot_boots,
  title: slot_title,
  pet: slot_pet,
  relic: slot_relic,
  cosmetic_hat: slot_hat,
  cosmetic_cloak: slot_cloak,
  left_ring: slot_ring,
  right_ring: slot_ring,
})

export { default as level_emblem } from './assets/level_emblem.png'
