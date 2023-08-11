/** @param {import('../world').LivingWorld} world */
export default function register_experience_firework(world) {
  const { next_entity_id } = world
  return {
    ...world,
    new_level_firework_entity_id: next_entity_id,
    next_entity_id: next_entity_id + 1,
  }
}
