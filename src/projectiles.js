import { on } from 'events'
import { setInterval, setTimeout } from 'timers/promises'

import combineAsyncIterators from 'combine-async-iterators'
import { aiter } from 'iterator-helper'
import Vec3 from 'vec3'

import { get_block, in_chunk } from './chunk.js'
import {
  create_state,
  PlayerEvent,
  ProjectileInstanceAction,
  // ProjectileAction,
  // ProjectileEvent,
  ProjectileInstanceEvent,
} from './events.js'
import { abortable } from './iterator.js'
import { block_position, position_equal } from './position.js'
import { register as register_basic_arrow } from './projectiles/basic_arrow.js'

/** @typedef {Readonly<typeof initial_instance_state} ProjectileInstanceState */
const initial_instance_state = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  alive: false,
  damager: null,
}

const PROJECTILE_UPDATE_INTERVAL = 50

// /** @typedef {Readonly<typeof initial_state} ProjectileState */
// const initial_state = {
//   cursor: 0,
//   instances_count: 0,
// }

// /** @type ProjectilesReducer */
// function reduce_spawn_next(state, { type, payload }) {
//   if (type === ProjectileAction.SPAWN_NEXT) {
//     return {
//       ...state,
//       cursor: (state.cursor + 1) % state.instances_count,
//     }
//   }

//   return state
// }

/** @type ProjectilesInstanceReducer */
function reduce_kill_instance(state, { type, payload }) {
  if (type === ProjectileInstanceAction.KILL) {
    return {
      ...state,
      alive: false,
    }
  }
  return state
}

/** @type ProjectilesInstanceReducer */
function reduce_init_instance(state, { type, payload }) {
  if (type === ProjectileInstanceAction.INIT) {
    const { position, velocity } = payload

    return {
      ...state,
      alive: true,
      position,
      velocity,
    }
  }
  if (type === ProjectileInstanceAction.UPDATE_MOVEMENT) {
    const { position, velocity } = payload

    return {
      ...state,
      position,
      velocity,
    }
  }
  return state
}

// /** @type ProjectileState */
// /** @typedef {{ type: string, payload: any, time: number }} ProjectileAction */
// /** @typedef {{ world: import('./context').World, type: string, entity_id: number }} ProjectileContext */
// /** @typedef {(state: ProjectileState, action: ProjectileAction, context?: ProjectileContext) => ProjectileState} ProjectilesReducer */
// export function reduce_projectile(state, action, context) {
//   return [reduce_spawn_next].reduce(
//     async (intermediate, fn) => fn(await intermediate, action, context),
//     state
//   )
// }

/** @type ProjectileInstanceState */
/** @typedef {{ type: string, payload: any, time: number }} ProjectileInstanceAction */
/** @typedef {{ world: import('./context').World, type: string, entity_id: number }} ProjectileInstanceContext */
/** @typedef {(state: ProjectileInstanceState, action: ProjectileInstanceAction, context?: ProjectileInstanceContext) => ProjectileInstanceState} ProjectilesInstanceReducer */
export function reduce_projectile_instance(state, action, context) {
  return [reduce_kill_instance, reduce_init_instance].reduce(
    async (intermediate, fn) => fn(await intermediate, action, context),
    state
  )
}

export function register_projectile({
  id,
  entities_count,
  instances_count,
  speed,
  drag,
  gravity,
}) {
  return world => {
    const instances = Array.from({ length: instances_count }).map((_, id) =>
      create_state(
        {
          state_event: ProjectileInstanceEvent.STATE_UPDATED,
          initial_state: initial_instance_state,
          state_reducer: reduce_projectile_instance,
        },
        () => ({ world: world.get(), id })
      )
    )

    // const projectile_state = create_state(
    //   {
    //     state_event: ProjectileEvent.STATE_UPDATED,
    //     initial_state,
    //     state_reducer: reduce_projectile,
    //   },
    //   () => ({ world: world.get(), id })
    // )

    return {
      ...world,
      projectiles: {
        ...world.projectiles,
        [id]: {
          size: entities_count * instances_count,
          start_id: world.next_entity_id,
          speed,
          drag,
          gravity,
          instances,
          // ...projectile_state,
        },
      },
      next_entity_id: world.next_entity_id + entities_count * instances_count,
    }
  }
}

export function register(world) {
  return [register_basic_arrow].reduce((world, fn) => fn(world), world)
}

// function on_chunk_loaded({ world }) {
//   return chunk => {
//     Object.values(world.projectiles).forEach(projectile => {
//       const { instances } = projectile

//       instances.forEach(({ get_state, events }) => {
//         const { position, alive } = get_state()
//         if (alive && in_chunk(position, chunk)) {
//           events.emit(ProjectileInstanceEvent.SPAWN)
//         }
//       })
//     })
//   }
// }

// function on_chunk_unloaded({ world }) {
//   return chunk => {
//     Object.values(world.projectiles).forEach(projectile => {
//       const { instances } = projectile

//       instances.forEach(({ get_state, events }) => {
//         const { position } = get_state()
//         if (!in_chunk(position, chunk)) {
//           events.emit(ProjectileInstanceEvent.DESPAWN)
//         }
//       })
//     })
//   }
// }

export default {
  /** @type {import('./context.js').Reducer} */
  reduce(state, { type, payload }) {
    return state
  },

  /** @type {import('./context.js').Observer} */
  observe(context) {
    const { events, world, signal, inside_view } = context

    // events.on(PlayerEvent.CHUNK_LOADED, on_chunk_loaded(context))
    // events.on(PlayerEvent.CHUNK_UNLOADED, on_chunk_unloaded(context))

    aiter(abortable(on(events, PlayerEvent.LAUNCH_PROJECTILE, { signal })))
      .map(([state]) => state)
      .reduce(
        (state, { id, forward, position }) => {
          const { instances, speed } = world.projectiles[id]
          const next_cursor = (state[id] + 1) % Object.keys(instances).length
          const { dispatch } = instances[next_cursor]

          const velocity = Vec3([forward.x, forward.y, forward.z])
            .clone()
            .normalize()
            .scale(speed)

          dispatch(ProjectileInstanceAction.INIT, { position, velocity })
          return {
            ...state,
            [id]: next_cursor,
          }
        },
        Object.keys(world.projectiles).reduce(
          (curr, projectile_id) => ({
            ...curr,
            [projectile_id]: -1,
          }),
          {}
        )
      )

    Object.values(world.projectiles).forEach(projectile => {
      const { instances, drag, gravity } = projectile

      instances.forEach(({ get_state, events, dispatch }) => {
        aiter(
          // @ts-ignore
          combineAsyncIterators(
            on(events, ProjectileInstanceEvent.STATE_UPDATED),
            setInterval(PROJECTILE_UPDATE_INTERVAL, [{ timer: true }])
          )
        )
          .map(([state]) => state)
          .reduce((state, { position, velocity, alive, timer }) => {
            const { was_alive, prev_pos, prev_velocity, hit_object } = state

            if (timer) {
              if (was_alive && prev_velocity && prev_pos && !hit_object) {
                // const new_velocity = prev_velocity.clone().scale(0.99)

                get_block(world, prev_pos).then(block => {
                  if (block.boundingBox === 'block') {
                    dispatch(ProjectileInstanceAction.UPDATE_MOVEMENT, {
                      position: prev_pos,
                      velocity: { x: 0, y: 0, z: 0 },
                    })
                    return {
                      ...state,
                      hit_object: true,
                    }
                  } else {
                    const interval = PROJECTILE_UPDATE_INTERVAL / 50
                    const inverted_drag = 1 - drag * interval
                    const new_pos = {
                      x: prev_pos.x + prev_velocity.x * interval,
                      y: prev_pos.y + prev_velocity.y * interval,
                      z: prev_pos.z + prev_velocity.z * interval,
                    }
                    const new_vel = {
                      x: prev_velocity.x * inverted_drag + gravity.x * interval,
                      y: prev_velocity.y * inverted_drag + gravity.y * interval,
                      z: prev_velocity.z * inverted_drag + gravity.z * interval,
                    }
                    dispatch(ProjectileInstanceAction.UPDATE_MOVEMENT, {
                      position: new_pos,
                      velocity: new_vel,
                    })
                  }
                })
              }
              return state
            }

            return {
              ...state,
              was_alive: alive,
              prev_pos: position,
              prev_velocity: velocity,
            }
          })
      })
    })
  },
}
