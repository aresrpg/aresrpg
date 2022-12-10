import Vec3 from 'vec3'

let defaultDeltaMovement = Vec3({ x: 0.0, y: 0.0, z: 0.0 }) // So Magic
const onGround = false // Same Magic

function fromPlayer(client, player_state, entity_hit) {
  if (!!player_state && !!entity_hit) {
    const entity_position = entity_hit.position()
    const entity_state = entity_hit.get_state()
    const distance = Vec3({ ...player_state.position }).distanceTo(
      Vec3({ ...entity_position })
    )
    console.log('Distance = ', distance)
    let d1 = player_state.position.x - entity_position.x

    let d0
    for (
      d0 = player_state.position.z - entity_position.z;
      d1 * d1 + d0 * d0 < Math.pow(1.0, -4);
      d0 = (Math.random() - Math.random()) * 0.01
    ) {
      d1 = (Math.random() - Math.random()) * 0.01
    }
    console.log('d0 : ', d0)
    console.log('d1 : ', d1)
    console.log('Entity : ', entity_hit)
    console.log('Entity pos : ', entity_position)
    console.log('Entity state : ', entity_state)

    const hurtDir = Math.abs(
      Math.atan2(d0, d1) * (180 / Math.PI) - entity_state.look_at.yaw
    )
    console.log('Hurt Dir : ', hurtDir)
    const direction_to_yaw_pitch = Vec3({ x: d1, y: 0.0, z: d0 })
      .normalize()
      .scale(hurtDir)
    console.log('direction_to_yaw_pitch : ', direction_to_yaw_pitch)
    const knockbackVector = Vec3({
      x: (player_state.position.x + distance) * 1.5,
      y: distance,
      z: (player_state.position.z + distance) * 1.5,
    })
    direction_to_yaw_pitch.x = direction_to_yaw_pitch.x + distance * 1.5
    direction_to_yaw_pitch.z = direction_to_yaw_pitch.z + distance * 1.5
    direction_to_yaw_pitch.y = distance
    console.log('direction_to_yaw_pitch ', direction_to_yaw_pitch)
    client.write('entity_velocity', {
      entityId: entity_hit.entity_id,
      x: direction_to_yaw_pitch.x,
      y: knockbackVector.y,
      z: direction_to_yaw_pitch.z,
    })
    // apply(client, entity_hit, hurtDir, 0.4, d1, d0);
  }
}

function fromMob(client, mob, entity_hit) {
  if (!!mob && !!entity_hit) {
    let d1 = mob.position().x - entity_hit.getX()

    let d0
    for (
      d0 = mob.position().z - entity_hit.position().z;
      d1 * d1 + d0 * d0 < 1.0 - 4;
      d0 = (Math.random() - Math.random()) * 0.01
    ) {
      d1 = (Math.random() - Math.random()) * 0.01
    }

    const hurtDir = Math.atan2(d0, d1) * (180 / Math.PI) - entity_hit.getYRot()
    apply(client, entity_hit, hurtDir, 0.4, d1, d0)
  }
}

function apply(client, mob, hurtDir, dX, dY, dZ) {
  dX *= 1.0 // - this.getAttributeValue(Attributes.KNOCKBACK_RESISTANCE); // x = x * 1.0 - this.getAttributeValue(Attributes.KNOCKBACK_RESISTANCE)
  console.log('dX : ', dX)
  if (!(dX <= 0.0)) {
    // this.hasImpulse = true; // ?
    const deltaMovement = defaultDeltaMovement // vec3
    console.log(' dY :', dY)
    console.log(' dZ :', dZ)
    console.log(deltaMovement)
    const otherDeltaMovement = Vec3({ x: dY, y: 0.0, z: dZ })
      .normalize()
      .scale(dX)
    console.log(deltaMovement)
    console.log(otherDeltaMovement)
    console.log(deltaMovement.x / 2.0 - otherDeltaMovement.x)
    console.log(
      onGround ? Math.min(0.4, deltaMovement.y / 2.0 + dX) : deltaMovement.y
    )
    console.log(deltaMovement.z / 2.0 - otherDeltaMovement.z)
    defaultDeltaMovement = Vec3({
      x: deltaMovement.x / 2.0 - otherDeltaMovement.x,
      y: onGround ? Math.min(0.4, deltaMovement.y / 2.0 + dX) : deltaMovement.y,
      z: deltaMovement.z / 2.0 - otherDeltaMovement.z,
    })
    console.log('defaultDeltaMovement : ', defaultDeltaMovement)
    client.write('entity_velocity', {
      entityId: mob.entity_id,
      x: -0.167875,
      y: defaultDeltaMovement.y,
      z: defaultDeltaMovement.z,
    })
  }
}

export default (clients, entity_damager, entity_hit) => {
  if (entity_damager.nickname) fromPlayer(clients, entity_damager, entity_hit)
  else fromMob(clients, entity_damager, entity_hit)
}

// Source : minecraft  version 1.16 / url source : https://github.com/Hexeption/MCP-Reborn branch 1.16-MOJO
// src -> main -> java -> net -> minecraft -> word -> entity -> LivingEntity : Line 1362
// public void knockback(double p_147241_, double p_147242_, double p_147243_) {
//     p_147241_ *= 1.0D - this.getAttributeValue(Attributes.KNOCKBACK_RESISTANCE);
//     if (!(p_147241_ <= 0.0D)) {
//        this.hasImpulse = true;
//        Vec3 vec3 = this.getDeltaMovement();
//        Vec3 vec31 = (new Vec3(p_147242_, 0.0D, p_147243_)).normalize().scale(p_147241_);
//        this.setDeltaMovement(vec3.x / 2.0D - vec31.x, this.onGround ? Math.min(0.4D, vec3.y / 2.0D + p_147241_) : vec3.y, vec3.z / 2.0D - vec31.z);
//     }
//  }

// Source : minecraft  version 1.16 / url source : https://github.com/Hexeption/MCP-Reborn branch 1.16-MOJO
// src -> main -> java -> net -> minecraft -> word -> entity -> LivingEntity : Line 1113
// if (entity1 != null) {
//     double d1 = entity1.getX() - this.getX();

//     double d0;
//     for(d0 = entity1.getZ() - this.getZ(); d1 * d1 + d0 * d0 < 1.0E-4D; d0 = (Math.random() - Math.random()) * 0.01D) {
//        d1 = (Math.random() - Math.random()) * 0.01D;
//     }

//     this.hurtDir = (float)(Mth.atan2(d0, d1) * (double)(180F / (float)Math.PI) - (double)this.getYRot());
//     this.knockback((double)0.4F, d1, d0);
//  } else {
//     this.hurtDir = (float)((int)(Math.random() * 2.0D) * 180);
//  }
