import UUID from 'uuid-1345'

export function check_shoot({ client, get_state }) {
  client.on('use_item', (hand) => {
    const state = get_state()

    const entityData = {
      // Velocity Does'nt work
      entityId: 4444,
      objectUUID: UUID.v4(),
      type: 2,
      x: 467,
      y: 165,
      z: 655,
      pitch: 50,
      yaw: 50,
      objectData: state.entity_id - 1,
      velocityX: 10,
      velocityY: 20,
      velocityZ: 10,
    }

    client.write('spawn_entity', entityData)
    console.log(entityData)
  })
}
