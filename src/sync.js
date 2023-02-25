import { get_held_item, to_vanilla_item } from './items.js'

/** Provide the exact fields required to send a synchronisation of a player from its client and state */
export function synchronisation_payload(
  client,
  {
    health,
    position,
    held_slot_index,
    inventory,
    inventory: { head, chest, legs, feet, hotbar },
  }
) {
  return {
    uuid: client.uuid,
    username: client.username,
    health,
    position,
    helmet: to_vanilla_item(head),
    chestplate: to_vanilla_item(chest),
    leggings: to_vanilla_item(legs),
    boots: to_vanilla_item(feet),
    held_item: to_vanilla_item(get_held_item({ held_slot_index, inventory })),
  }
}
