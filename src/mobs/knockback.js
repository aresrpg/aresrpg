import { to_direction } from '../math.js'

function fromPlayer(client, player_state, entity_hit) {
  if (!!player_state && !!entity_hit) {
    const direction_player = to_direction(
      player_state.position.yaw,
      player_state.position.pitch
    )
    console.log('direction ', direction_player)
    const velocity = direction_player.scale(8000) // knockback with a strenght of 5
    apply(client, entity_hit.entity_id, velocity)
  }
}

function fromMob(client, mob, entity_hit) {
  // const direction_mob = to_direction(player_state.position.yaw, player_state.position.pitch)
  // const velocity = direction_mob.scale(8000)
  // apply(client, entity_hit, hurtDir, 0.4, d1, d0)
}

function apply(client, entity_id, velocity) {
  client.write('entity_velocity', {
    entityId: entity_id,
    velocityX: velocity.x,
    velocityY: velocity.y,
    velocityZ: velocity.z,
  })
}

export default (clients, entity_damager, entity_hit) => {
  if (entity_damager.nickname) fromPlayer(clients, entity_damager, entity_hit)
  else fromMob(clients, entity_damager, entity_hit)
}
