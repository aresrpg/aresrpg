import { to_vanilla_item } from './items.js'

/** Provide the exact fields required to send a synchronisation of a player from its client and state */
export function synchronisation_payload(client, state) {
  const {
    health,
    position,
    inventory: { head, chest, legs, feet, weapon },
  } = state
  return {
    uuid: client.uuid,
    username: client.username,
    health,
    position,
    helmet: to_vanilla_item(head, state),
    chestplate: to_vanilla_item(chest, state),
    leggings: to_vanilla_item(legs, state),
    boots: to_vanilla_item(feet, state),
    weapon: to_vanilla_item(weapon, state),
  }
}
