import { to_slot } from './player/inventory.js'

export function create_player(
  client,
  entityId,
  equipement,
  { x, y, z },
  yaw,
  headYaw
) {
  const player = {
    entityId,
    playerUUID: client.uuid,
    x,
    y,
    z,
    yaw,
    pitch: 0,
  }
  client.write('named_entity_spawn', player)
  client.write('entity_teleport', player)

  client.write('entity_head_rotation', {
    entityId,
    headYaw,
  })

  const entity_equipement = {
    entityId,
    equipments: equipement.map(item => ({
      slot: equipement.indexOf(item),
      item: to_slot(item),
    })),
  }
  client.write('entity_equipment', entity_equipement)

  const team = {
    team: 'menu',
    mode: 0,
    name: JSON.stringify({ text: 'menu' }),
    friendlyFire: 0,
    nameTagVisibility: 'never',
    collisionRule: 'always',
    formatting: 0,
    prefix: JSON.stringify({ text: '' }),
    suffix: JSON.stringify({ text: '' }),
    players: [client.username],
  }

  client.write('teams', team)
}
