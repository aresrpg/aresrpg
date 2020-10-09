import UUID from 'uuid-1345'

export function spawnVillager({client}) {
    let mob = {
        entityId: 69420, // temporaire 
        entityUUID: UUID.v4(),
        type: 93, // villager
        x: 469,
        y: 163, // in front of the spawn
        z: 649,
        yaw: 0,
        pitch: 0,
        headPitch: 0,
        velocityX: 400,
        velocityY: 400,
        velocityZ: 400
    }
    client.write('spawn_entity_living', mob)

}
