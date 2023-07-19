import { to_vanilla_item } from './items.js'

/** Provide the exact fields required to send a synchronisation of a player from its client and state */
export function synchronisation_payload(
  client,
  {
    health,
    position,
    inventory,
    characteristics,
    inventory: { head, chest, legs, feet, weapon },
  }
) {
  const options = { inventory, characteristics }
  return {
    uuid: client.uuid,
    username: client.username,
    health,
    position,
    helmet: to_vanilla_item(head, options),
    chestplate: to_vanilla_item(chest, options),
    leggings: to_vanilla_item(legs, options),
    boots: to_vanilla_item(feet, options),
    weapon: to_vanilla_item(weapon, options),
  }
}
