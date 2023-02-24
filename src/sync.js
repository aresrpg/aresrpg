/** Provide the exact fields required to send a synchronisation of a player from its client and state */
export function synchronisation_payload(client, { health, position }) {
  return {
    uuid: client.uuid,
    username: client.username,
    health,
    position,
  }
}
