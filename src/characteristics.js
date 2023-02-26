import { get_equipped_characteristic } from './equipments.js'
import { experience_to_level } from './experience.js'
import { normalize_range } from './math.js'

export const ELEMENTS = {
  earth: 'earth',
  fire: 'fire',
  water: 'water',
  air: 'air',
}

const BASE_LIFE = 20
// each new level, players get 5 additional life points
const LIFE_PER_LEVEL = 5
const STAT_POINT_PER_LEVEL = 5

const BASE_DELAY_BETWEEN_HITS = 700
const MIN_DELAY_BETWEEN_HITS = 150
const MAX_DELAY_BETWEEN_HITS = 2000

// this means the most powerful players could have as much as 8 of haste
const ESTIMATED_HASTE_UPPER_BOUND = 8
const ESTIMATED_HASTE_LOWER_BOUND = -8

export const Characteristic = {
  VITALITY: 'vitality',
  MIND: 'mind',
  STRENGTH: 'strength',
  INTELLIGENCE: 'intelligence',
  CHANCE: 'chance',
  AGILITY: 'agility',
  SPEED: 'speed',
  REACH: 'reach',
  HASTE: 'haste',
}

export function characteristic_from_element(element) {
  switch (element) {
    case 'earth':
      return Characteristic.STRENGTH
    case 'fire':
      return Characteristic.INTELLIGENCE
    case 'water':
      return Characteristic.CHANCE
    case 'air':
      return Characteristic.AGILITY
    default:
      throw new Error(`${element} is not a valid element`)
  }
}

/**
 * Compute base stats with equipped items to
 * return the total characteristic value for a player
 */
export function get_total_characteristic(
  characteristic_name,
  { inventory, characteristics }
) {
  const from_base = characteristics[characteristic_name] ?? 0
  const from_equipments = get_equipped_characteristic(
    characteristic_name,
    inventory
  )
  return from_base + from_equipments
}

export function get_max_health({ experience, inventory, characteristics }) {
  const { level } = experience_to_level(experience)
  // it's okay to include lvl 1 here, let's start at 25
  const life_level_bonus = level * LIFE_PER_LEVEL
  const life_vitality_bonus = get_total_characteristic(
    Characteristic.VITALITY,
    {
      inventory,
      characteristics,
    }
  )
  return BASE_LIFE + life_level_bonus + life_vitality_bonus
}

export function get_fixed_damage({ inventory }) {
  return 0
}

/** Calculate the MS delay between arm attack from the haste stat */
export function get_attack_delay(unsafe_haste) {
  const haste = Math.max(
    ESTIMATED_HASTE_LOWER_BOUND,
    Math.min(ESTIMATED_HASTE_UPPER_BOUND, unsafe_haste)
  )
  if (haste >= 0)
    return Math.round(
      normalize_range(
        haste,
        { min: 0, max: ESTIMATED_HASTE_UPPER_BOUND },
        { min: BASE_DELAY_BETWEEN_HITS, max: MIN_DELAY_BETWEEN_HITS }
      )
    )
  return Math.round(
    normalize_range(
      haste,
      { min: ESTIMATED_HASTE_LOWER_BOUND, max: 0 },
      { min: MAX_DELAY_BETWEEN_HITS, max: BASE_DELAY_BETWEEN_HITS }
    )
  )
}

export function get_remaining_stats_point({ characteristics, experience }) {
  const { level } = experience_to_level(experience)
  const attributed = Object.values(characteristics).reduce((a, b) => a + b, 0)
  const total_for_level = (level - 1) * STAT_POINT_PER_LEVEL
  return total_for_level - attributed
}
