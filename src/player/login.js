import vecmath from 'vecmath'

import { chunk_position } from '../chunk.js'
import { write_brand } from '../plugin_channels.js'
import { dimension_codec, overworld } from '../world/codec.js'
import { load_chunks } from '../chunk/update.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { write_title } from '../title.js'
import { Context } from '../events.js'
import { Formats, world_chat_msg } from '../chat.js'

import { set_world_border } from './world_border.js'
import { rainbow_geometry, sphere_geometry } from './particles/geometries.js'
import {
  mesh,
  render_mesh,
  render_particles,
  updateMaterial,
  updateTransformMatrix,
} from './particles/particles.js'
import {
  basic_material,
  rainbow_rainbow_material,
} from './particles/materials.js'

const { Vector3 } = vecmath

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal, dispatch }) {
    events.once(Context.STATE, state => {
      const {
        nickname,
        game_mode,
        position,
        view_distance,
        held_slot_index,
        last_disconnection_time,
      } = state
      // TODO: move this elsewhere
      const world_names = ['minecraft:overworld']
      // TODO: we should not take the first world of the list
      const [world_name] = world_names

      client.write('login', {
        entityId: PLAYER_ENTITY_ID,
        isHardcore: false,
        gameMode: game_mode,
        previousGameMode: 255,
        worldNames: world_names,
        dimensionCodec: dimension_codec,
        dimension: overworld,
        worldName: world_name,
        hashedSeed: [0, 0],
        maxPlayers: 32,
        viewDistance: view_distance,
        reducedDebugInfo: false,
        enableRespawnScreen: false,
        isDebug: false,
        isFlat: false,
      })

      client.write('spawn_position', { location: world.spawn_position })

      write_brand(client, { brand: 'AresRPG' })

      client.write('position', {
        ...position,
        flags: 0x00,
        teleportId: 0,
      })

      const chunk = {
        x: chunk_position(position.x),
        z: chunk_position(position.z),
      }

      client.write('update_view_position', {
        chunkX: chunk.x,
        chunkZ: chunk.z,
      })

      set_world_border({ client, x: 510, z: 510, radius: 1020, speed: 1 })

      load_chunks(state, { client, world, events, chunks: [chunk] })

      client.write('held_item_slot', { slot: held_slot_index })

      write_title({
        client,
        subtitle: { text: 'Welcome on AresRPG' },
        times: {
          fadeIn: 2,
          fadeOut: 2,
          stay: 10,
        },
      })

      if (!last_disconnection_time)
        world_chat_msg({
          world,
          client,
          message: [
            { text: nickname, ...Formats.SUCCESS },
            { text: ' just joined ', ...Formats.BASE },
            { text: 'AresRPG', ...Formats.INFO },
            { text: ' for the first time', ...Formats.BASE },
          ],
        })

      const particle_pos = {
        ...world.spawn_position,
        y: world.spawn_position.y + 30,
      }

      const rainbow = mesh({
        geometry: rainbow_geometry({
          min_radius: 3,
          max_radius: 5,
          center: { x: 0, y: 0, z: 0 },
          segments: 60,
        }),
        material: rainbow_rainbow_material({ progress: 1 }),
        position: particle_pos,
        rotation: new Vector3(0, 0, 0),
        scale: new Vector3(2, 2, 2),
      })

      const sphere = mesh({
        geometry: sphere_geometry({
          radius: 2.5,
          height_segments: 15,
          width_segments: 30,
        }),
        material: basic_material({
          color: { red: 1, green: 0, blue: 0 },
          scale: 2,
        }),
        position: particle_pos,
        rotation: new Vector3(0, 0, 0),
        scale: new Vector3(1, 1, 1),
      })
      let t = 0
      setInterval(() => {
        t += 0.01
        updateMaterial(rainbow, rainbow_rainbow_material({ progress: t }))
        const final_vertex = render_mesh(rainbow).concat(render_mesh(sphere))

        render_particles(client, final_vertex)
        if (t >= 1) {
          t = 0
          rainbow.rotation.y += Math.PI
          updateTransformMatrix(rainbow)
        }
      }, 500)
    })
  },
}
