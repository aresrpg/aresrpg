import { on } from 'events'

import { aiter } from 'iterator-helper'
import vecmath from 'vecmath'

import { chunk_position } from '../chunk.js'
import { empty_slot, item_to_slot } from '../items.js'
import { write_brand } from '../plugin_channels.js'
import { dimension_codec, overworld } from '../world/codec.js'
import { load_chunks } from '../chunk/update.js'
import { PLAYER_ENTITY_ID, PLAYER_INVENTORY_ID } from '../index.js'

import { write_title } from './title.js'
import { set_world_border } from './world_border.js'
import {
  copy_canvas,
  create_screen_canvas,
  spawn_screen,
  update_screen,
} from './screen.js'
import { mesh, torus_geometry, updateTransformMatrix } from './particles.js'

const { Vector3 } = vecmath

/**
//  * Converts an HSL color value to RGB. Conversion formula
//  * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
//  * Assumes h, s, and l are contained in the set [0, 1] and
//  * returns r, g, and b in the set [0, 255].
//  *
//  * @param   {number}  h       The hue
//  * @param   {number}  s       The saturation
//  * @param   {number}  l       The lightness
//  * @return  {any}           The RGB representation
//  */
// function hslToRgb(h, s, l) {
//   let r, g, b

//   if (s === 0) {
//     r = g = b = l // achromatic
//   } else {
//     const hue2rgb = function hue2rgb(p, q, t) {
//       if (t < 0) t += 1
//       if (t > 1) t -= 1
//       if (t < 1 / 6) return p + (q - p) * 6 * t
//       if (t < 1 / 2) return q
//       if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
//       return p
//     }

//     const q = l < 0.5 ? l * (1 + s) : l + s - l * s
//     const p = 2 * l - q
//     r = hue2rgb(p, q, h + 1 / 3)
//     g = hue2rgb(p, q, h)
//     b = hue2rgb(p, q, h - 1 / 3)
//   }

//   return {
//     r,
//     g,
//     b,
//   }
// }

export default {
  /** @type {import('../index.js').Observer} */
  observe({ client, events, world }) {
    events.once('state', (state) => {
      const { game_mode, position, inventory, view_distance } = state
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
        enableRespawnScreen: true,
        isDebug: false,
        isFlat: false,
      })

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

      const to_slot = (item) =>
        item ? item_to_slot(world.items[item.type], item.count) : empty_slot

      client.write('window_items', {
        windowId: PLAYER_INVENTORY_ID,
        items: inventory.map(to_slot),
      })

      write_title(client, {
        subtitle: { text: 'Bienvenue sur' },
        title: { text: 'AresRPG' },
        fadeIn: 2,
        fadeOut: 2,
        stay: 3,
      })

      const screen_pos = {
        ...world.spawn_position,
        y: world.spawn_position.y + 15,
      }
      spawn_screen(
        { client, world },
        {
          screen_id: 'player_screen',
          position: screen_pos,
          direction: { x: 1, y: 0, z: 0 },
        }
      )

      const { canvas } = create_screen_canvas(world.screens.player_screen)

      aiter(on(events, 'screen_interract')).reduce(
        (old_canvas, [{ x, y, screen_id, hand }]) => {
          const new_canvas = copy_canvas(old_canvas)

          const ctx = new_canvas.getContext('2d')
          ctx.font = '30px arial'
          ctx.fillStyle = 'red'
          ctx.beginPath()
          ctx.ellipse(x, y, 10, 10, 0, 0, Math.PI * 2)
          ctx.fill()

          update_screen(
            { client, world },
            { screen_id, new_canvas, old_canvas }
          )

          return new_canvas
        },
        canvas
      )

      const particle_pos = {
        ...world.spawn_position,
        y: world.spawn_position.y + 30,
      }

      const spawn_particle = ({
        position: { x, y, z },
        color: { r, g, b },
        scale,
      }) => {
        client.write('world_particles', {
          particleId: 14,
          longDistance: true,
          x,
          y,
          z,
          offsetX: 0,
          offsetY: 0,
          offsetZ: 0,
          particles: 1,
          particleData: 0,
          data: {
            red: r,
            green: g,
            blue: b,
            scale: 1,
          },
        })
      }

      // const circle_vertices = ({ radius, sides, center }) => {
      //   const vertices = [];
      //   for (let a = 0; a < 2 * Math.PI; a += (2 * Math.PI) / sides)
      //   {
      //     const position = new Vector3({
      //       x: center.x + Math.cos(a) * radius,
      //       y: center.y + Math.sin(a) * radius,
      //       z: center.z
      //     })
      //     vertices.push(position)
      //   }
      //   return vertices;
      // }

      const render_particles = ({ vertex }) => {
        vertex.forEach(({ vertice, color }) => {
          spawn_particle({ position: vertice, color, scale: 1 })
        })
      }

      const geometry = torus_geometry({
        center: { x: 0, y: 0, z: 0 },
        radial_segments: 30,
        tubular_segments: 100,
        radius: 5,
        tube: 2,
      })

      const torus = mesh({
        geometry,
        material: null,
        position: particle_pos,
        rotation: new Vector3(0, 0, 0),
        scale: new Vector3(1, 1, 1),
      })

      let t = 0
      setInterval(() => {
        t += 0.1
        const final_vertex = []
        torus.rotation.x = t
        updateTransformMatrix(torus)
        final_vertex.push(
          ...torus.geometry.vertices.map((vertice) => ({
            vertice: vertice.clone().transformMat4(torus.transformMatrix),
            color: { r: 1, g: 0, b: 0 },
          }))
        )
        render_particles({ vertex: final_vertex })
      }, 200)
    })
  },
}
