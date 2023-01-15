import { on } from 'events'

import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'
import { aiter } from 'iterator-helper'

import { register_projectile } from '../projectiles.js'
import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'
import { ProjectileInstanceAction, ProjectileInstanceEvent } from '../events.js'
import { direction_to_yaw_pitch, distance3d_squared } from '../math.js'
import { position_equal } from '../position.js'

const mcData = minecraftData(VERSION)

export const BASIC_ARROW_ID = 'PROJECTILE:BASIC_ARROW'

export function register(world) {
  return register_projectile({
    id: BASIC_ARROW_ID,
    entities_count: 1,
    instances_count: 5,
    speed: 2,
    drag: 0.01,
    gravity: { x: 0, y: -0.05, z: 0 },
  })(world)
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { world, client } = context
    const arrow_projectile = world.projectiles[BASIC_ARROW_ID]
    if (!arrow_projectile) return

    const { instances } = arrow_projectile
    instances.forEach(
      ({ events: projectile_events, dispatch }, instance_id) => {
        // const arrow_context = { instance_id, projectile: arrow_projectile }

        // projectile_events.on(
        //   ProjectileInstanceEvent.SPAWN,
        //   on_spawn_arrow(context, arrow_context)
        // )
        // projectile_events.on(
        //   ProjectileInstanceEvent.DESPAWN,
        //   on_despawn_arrow(context, arrow_context)
        // )

        aiter(on(projectile_events, ProjectileInstanceEvent.STATE_UPDATED))
          .map(([state]) => state)
          .reduce(
            (state, { position, velocity, alive }) => {
              const entity_id = arrow_projectile.start_id + instance_id
              const { prev_position, prev_velocity, was_alive } = state

              if (!position_equal(prev_position, position)) {
                if (
                  prev_position &&
                  distance3d_squared(position, prev_position) < 64
                ) {
                  client.write('rel_entity_move', {
                    entityId: entity_id,
                    dX: (position.x * 32 - prev_position.x * 32) * 128,
                    dY: (position.y * 32 - prev_position.y * 32) * 128,
                    dZ: (position.z * 32 - prev_position.z * 32) * 128,
                  })
                } else {
                  client.write('entity_teleport', {
                    entityId: entity_id,
                    ...position,
                    yaw: 0,
                    pitch: 0,
                    onGround: false,
                  })
                }
              }
              if (!position_equal(prev_velocity, velocity)) {
                client.write('entity_velocity', {
                  entityId: entity_id,
                  velocityX: velocity.x * 8000,
                  velocityY: velocity.y * 8000,
                  velocityZ: velocity.z * 8000,
                })
              }

              if (was_alive && !alive) {
                client.write('entity_destroy', { entityIds: [entity_id] })
              }

              if (!was_alive && alive) {
                const mob = {
                  entityId: entity_id,
                  objectUUID: UUID.v4(),
                  type: mcData.entitiesByName.arrow.id,
                  ...position,
                  yaw: 0,
                  pitch: 0,
                  velocityX: velocity.x * 8000,
                  velocityY: velocity.y * 8000,
                  velocityZ: velocity.z * 8000,
                }
                client.write('spawn_entity', mob)
                const metadata = {
                  entityId: entity_id,
                  metadata: to_metadata('arrow', {
                    has_no_gravity: true,
                  }),
                }
                client.write('entity_metadata', metadata)

                setTimeout(() => {
                  dispatch(ProjectileInstanceAction.KILL)
                }, 10000)
              }

              return {
                ...state,
                prev_velocity: velocity,
                prev_position: position,
                was_alive: alive,
              }
            },
            {
              prev_velocity: null,
              prev_position: null,
              was_alive: false,
            }
          )
      }
    )
  },
}
