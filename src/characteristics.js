import { get_equipped_characteristics } from './equipments.js'
import { experience_to_level } from './experience.js'

export const ELEMENTS = {
  earth: 'earth',
  fire: 'fire',
  water: 'water',
  air: 'air',
}

// each new level, players get 5 additional life points
const LIFE_PER_LEVEL = 5

export const CHARACTERISTICS = [
  'vitality',
  'mind',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'speed',
  'reach',
  'haste',
]

export const get_max_health = ({
  inventory,
  characteristics: { vitality },
  experience,
}) => {
  const { level } = experience_to_level(experience)
  const life_level_bonus = level * LIFE_PER_LEVEL
  const life_vitality_bonus = vitality * 2
  const { vitality: life_armor_bonus } = get_equipped_characteristics(inventory)
  return 20 + life_level_bonus + life_vitality_bonus + life_armor_bonus
}

export const get_remaining_stats_point = state => {
  return 0
}
