function pad_end(array, length) {
  return [...array, ...Array.from({ length })].slice(0, length)
}

export function to_inventory_array({
  crafting_output,
  crafting_input = [],
  head,
  chest,
  legs,
  feet,
  main_inventory = [],
  weapon,
  consumable,
}) {
  return [
    crafting_output,
    ...pad_end(crafting_input, 4),
    head,
    chest,
    legs,
    feet,
    ...pad_end(main_inventory, 27),
    ...pad_end([weapon], 9), // hotbar
    consumable,
  ]
}

/** Give back an AresRPG inventory by adding the content of an
 * inventory array. As inventory arrays contains less informations,
 * we still need the base `inventory` to take things like rings, etc..
 * Beware to not mix up an inventory array and a vanilla inventory array,
 * in an inventory array, we didn't map aresrpg items to vanilla items yet.
 */
export function from_inventory_array({ inventory, inventory_array }) {
  return {
    ...inventory,
    crafting_output: inventory_array[0],
    crafting_input: inventory_array.slice(1, 4),
    head: inventory_array[5],
    chest: inventory_array[6],
    legs: inventory_array[7],
    feet: inventory_array[8],
    main_inventory: inventory_array.slice(9, 35),
    weapon: inventory_array[36],
    consumable: inventory_array[45],
  }
}

/** @typedef {import('./types').Item} Item */
/** @typedef {import('./types').ItemStatistics} ItemStatistics */

/** @type {(items: Item[]) => (characteristic: keyof ItemStatistics) => number} */
function characteristics_sum(items) {
  return characteristic =>
    items
      .filter(item => item?.stats)
      .reduce(
        (total, { stats: { [characteristic]: value = 0 } }) => total + value,
        0
      )
}

export function get_equipped_characteristic(
  characteristic_name,
  { head, neck, chest, rings, belt, legs, feet, pet, relics, weapon }
) {
  const sum = characteristics_sum([
    head,
    neck,
    chest,
    ...rings,
    belt,
    legs,
    feet,
    pet,
    weapon,
    ...relics,
  ])

  return sum(characteristic_name)
}
