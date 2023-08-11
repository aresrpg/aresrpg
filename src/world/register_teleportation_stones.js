// TODO: should be made configurable, or should at least vary depending on the user's language
export const lines = [
  ({ name }) => [
    { text: '|| ', obfuscated: true, color: 'black' },
    { text: name, color: 'dark_green', obfuscated: false },
    { text: ' ||', obfuscated: true, color: 'black' },
  ],
  () => [
    { text: '>>', bold: true, color: 'dark_aqua' },
    { text: ' Pierre de téléportation', color: 'gold' },
    { text: ' <<', bold: true, color: 'dark_aqua' },
  ],
]

/**
 * @typedef {Object} TeleportationStone
 * @property {string} name - the teleportation stone name
 * @property {import("../types").SimplePosition} position - where the teleportation stone will be displayed
 * @property {number} window_id - the entity_ids of the entities used to display everything
 * @property {number[]} entity_ids - the entity_ids of the entities used to display everything
 */

/** @param {import('../world').LivingWorld} world */
export default function register_teleportation_stones(world) {
  return {
    ...world,
    next_entity_id:
      world.next_entity_id +
      world.teleportation_stones.length * lines.length * 2,
    next_window_id: world.next_window_id + world.teleportation_stones.length,
    teleportation_stones: world.teleportation_stones.map(
      (stone, stone_index) => ({
        ...stone,
        window_id: world.next_window_id + stone_index,
        entity_ids: Array.from({ length: lines.length * 2 }).map(
          (_, index) =>
            world.next_entity_id + stone_index * lines.length * 2 + index,
        ),
      }),
    ),
  }
}
