import { DAMAGE_INDICATORS_AMOUNT } from '../core/damage.js'

/** @param {import('../world').LivingWorld} world */
export default function register_damage_indicator({
  next_entity_id,
  ...world
}) {
  return {
    ...world,
    damage_indicator_start_id: next_entity_id,
    next_entity_id: next_entity_id + DAMAGE_INDICATORS_AMOUNT,
  }
}
