import { on } from 'events'
import { performance } from 'perf_hooks'
import { setInterval } from 'timers/promises'

import combineAsyncIterators from 'combine-async-iterators'
import { aiter } from 'iterator-helper'
import Ray from 'ray-3d'
import UUID from 'uuid-1345'
import Vec3 from 'vec3'

import { get_block } from './chunk.js'
import {
  create_state,
  PlayerEvent,
  ProjectileInstanceAction,
  // ProjectileAction,
  // ProjectileEvent,
  ProjectileInstanceEvent
} from './events.js'
import { abortable } from './iterator.js'
import { direction_to_yaw_pitch } from './math.js'
import { register as register_basic_arrow } from './projectiles/basic_arrow.js'

/** @typedef {Readonly<typeof initial_instance_state} ProjectileInstanceState */
const initial_instance_state = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
  pitch: 0,
  hit_object: null,
  uuid: null,
  alive: false,
  damager: null,
}

const PROJECTILE_COLLISION_INTERVAL = 50;
const PROJECTILE_POSITION_UPDATE_INTERVAL = 200;

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

function visitAll(gx0, gy0, gz0, gx1, gy1, gz1) {

  const gx0idx = Math.floor(gx0);
  const gy0idx = Math.floor(gy0);
  const gz0idx = Math.floor(gz0);

  const gx1idx = Math.floor(gx1);
  const gy1idx = Math.floor(gy1);
  const gz1idx = Math.floor(gz1);

  const sx = gx1idx > gx0idx ? 1 : gx1idx < gx0idx ? -1 : 0;
  const sy = gy1idx > gy0idx ? 1 : gy1idx < gy0idx ? -1 : 0;
  const sz = gz1idx > gz0idx ? 1 : gz1idx < gz0idx ? -1 : 0;

  let gx = gx0idx;
  let gy = gy0idx;
  let gz = gz0idx;

  // Planes for each axis that we will next cross
  const gxp = gx0idx + (gx1idx > gx0idx ? 1 : 0);
  const gyp = gy0idx + (gy1idx > gy0idx ? 1 : 0);
  const gzp = gz0idx + (gz1idx > gz0idx ? 1 : 0);

  // Only used for multiplying up the error margins
  const vx = gx1 === gx0 ? 1 : gx1 - gx0;
  const vy = gy1 === gy0 ? 1 : gy1 - gy0;
  const vz = gz1 === gz0 ? 1 : gz1 - gz0;

  // Error is normalized to vx * vy * vz so we only have to multiply up
  const vxvy = vx * vy;
  const vxvz = vx * vz;
  const vyvz = vy * vz;

  // Error from the next plane accumulators, scaled up by vx*vy*vz
  // gx0 + vx * rx === gxp
  // vx * rx === gxp - gx0
  // rx === (gxp - gx0) / vx
  let errx = (gxp - gx0) * vyvz;
  let erry = (gyp - gy0) * vxvz;
  let errz = (gzp - gz0) * vxvy;

  const derrx = sx * vyvz;
  const derry = sy * vxvz;
  const derrz = sz * vxvy;

  const points = [];

  do {
      // visitor(gx, gy, gz);
      points.push({ x: gx, y: gy, z:gz })

      if (gx === gx1idx && gy === gy1idx && gz === gz1idx) break;

      // Which plane do we cross first?
      const xr = Math.abs(errx);
      const yr = Math.abs(erry);
      const zr = Math.abs(errz);

      if (sx !== 0 && (sy === 0 || xr < yr) && (sz === 0 || xr < zr)) {
          gx += sx;
          errx += derrx;
      }
      else if (sy !== 0 && (sz === 0 || yr < zr)) {
          gy += sy;
          erry += derry;
      }
      else if (sz !== 0) {
          gz += sz;
          errz += derrz;
      }

  } while (true);

  return points;
}

async function find_block(world, from_pos, to_pos) {
  for (const point of visitAll(from_pos.x, from_pos.y, from_pos.z, to_pos.x, to_pos.y, to_pos.z)) {
    const block = await get_block(world, point);
    if (block.boundingBox !== 'empty') {
      return { point, block };
    }
  }
  return null;
}


/** @type ProjectilesInstanceReducer */
async function  reduce_init_instance(state, { type, payload }, { world }) {
  if (type === ProjectileInstanceAction.INIT) {
    const { position, velocity } = payload

    return {
      ...state,
      ...initial_instance_state,
      alive: true,
      uuid: UUID.v4(),
      position,
      velocity,
    }
  }
  if (type === ProjectileInstanceAction.UPDATE_MOVEMENT) {
    const { position, velocity, yaw, pitch, hit_object } = payload
    const { position: prev_pos } = state;

    if (!hit_object) {
      const start = performance.now();
      const collision = await find_block(world, prev_pos, position);
     
      if (collision && collision.block.boundingBox === 'block') {
          console.log('hit', collision.block.type)
          const direction = Vec3([position.x-prev_pos.x,  position.y-prev_pos.y , position.z-prev_pos.z]).normalize()
          const aabb = [[collision.point.x, collision.point.y, collision.point.z], [collision.point.x + 1, collision.point.y + 1, collision.point.z + 1]];
          const ray = new  Ray([prev_pos.x, prev_pos.y, prev_pos.z], [direction.x, direction.y, direction.z])
          const [ out_x, out_y, out_z] = ray.intersectsBox(aabb)

          console.log('hit', out_x, out_y, out_z);

          const timeTaken = performance.now() - start;
          console.log("Total time taken : " + timeTaken + " milliseconds");
          return {
            ...state,
            hit_object: {
              object_type: 'block',
              block: collision.block,
            },
            position: { x: out_x, y: out_y, z: out_z  },
            velocity: { x: 0, y: 0, z: 0 }
          }
      }  
    }
    return {
      ...state,
      position,
      velocity,
      yaw, 
      pitch
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

      instances.forEach(({ events, dispatch }) => {
        aiter(
          // @ts-ignore
          combineAsyncIterators(
            on(events, ProjectileInstanceEvent.STATE_UPDATED),
            setInterval(PROJECTILE_COLLISION_INTERVAL, [{ timer: true }])
          )
        )
          .map(([state]) => state)
          .reduce((state, { position, velocity, alive, hit_object, timer }) => {
            const { was_alive, prev_pos, prev_velocity, prev_hit_object } = state

            if (timer) {
              if (was_alive && prev_velocity && prev_pos && !prev_hit_object) {
                const interval = PROJECTILE_COLLISION_INTERVAL / 50
                const inverted_drag = 1 - drag * interval
                const new_vel = {
                  x: prev_velocity.x * inverted_drag + gravity.x * interval,
                  y: prev_velocity.y * inverted_drag + gravity.y * interval,
                  z: prev_velocity.z * inverted_drag + gravity.z * interval,
                }
                const new_pos = {
                  x: prev_pos.x + prev_velocity.x * interval,
                  y: prev_pos.y + prev_velocity.y * interval,
                  z: prev_pos.z + prev_velocity.z * interval,
                 
                }
               
                dispatch(ProjectileInstanceAction.UPDATE_MOVEMENT, {
                  position: new_pos,
                  velocity: new_vel,
                  ...direction_to_yaw_pitch(Vec3([new_vel.x, new_vel.y, new_vel.z]).normalize())
                })
              }
              return state
            }

            if (hit_object && hit_object !== prev_hit_object) {
              events.emit(ProjectileInstanceEvent.HIT_OBJECT, hit_object);
            }

            return {
              ...state,
              was_alive: alive,
              prev_pos: position,
              prev_velocity: velocity,
              prev_hit_object: hit_object,
            }
          })
      })
    })
  },
}
