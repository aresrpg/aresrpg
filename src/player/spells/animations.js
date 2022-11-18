import vecmath from 'vecmath'

import { circle_geometry, line_geometry, ring_geometry, sphere_geometry } from "../particles/geometries.js"
import { basic_material, fire_slash_material, rainbow_material, rgb_slash_material } from "../particles/materials.js"
import { mesh, ParticlesTypes, render_mesh, render_particles, spawn_particle, updateMaterial, updateTransformMatrix } from "../particles/particles.js"
import { play_sound } from '../../sound.js'
import { parseType } from 'graphql'
import { Colors } from '../../boss_bar.js'
import { copyFileSync } from 'fs'
import { direction_to_yaw_pitch, to_direction } from '../../math.js'
const { Vector3 } = vecmath

/*function delay_manager() {

}*/

export const spawn_sweep_attack = ({ client, position, radius, amount, speed = 0.2, scale = 1, colors = [{red: 1, green: 1, blue: 1, delay: 0}] }) => {
  const slash = mesh({
    geometry: sphere_geometry({
      radius,
      height_segments: amount,
      width_segments: 1,
      randomness: 0.01,
    }),
    material: rgb_slash_material({progress: 0.0}),
    position: position,
    rotation: new Vector3(-((Math.PI/3)*2)+Math.random()*Math.PI/3, 0 , Math.PI/2 - (position.yaw * Math.PI)/180.0),
    scale: new Vector3(1, 1, 1),
  })

  if (colors.length === 0) {
    const direction = to_direction(position.yaw, position.pitch)
    spawn_particle(
      client,
      {
        particle_id: ParticlesTypes.SWORD_SLASH,
        position: {y: position.y+direction.y, x: position.x+direction.x, z: position.z+direction.z},
        data: {},
      }
    )
  } else {
    const max_delay = () => {
      let max = 0
      colors.forEach(color => {
        max = Math.max(max, color.delay)
      })
      return max
    }
    let t = 0
    const interval = setInterval(() => {
      if (t > 1+max_delay()) {
        clearInterval(interval)
      } else {
        colors.forEach(color => {
          updateMaterial(slash, rgb_slash_material({progress: t-color.delay, color: {scale, ...color}}))
          render_particles(client, render_mesh(slash))
        });
      }
      t += speed
    }, 50)
  }
}

export const spawn_sword_slash = ({ client, position, radius, amount, speed = 0.2 }) => {
  const fire_slash = mesh({
    geometry: sphere_geometry({
      radius,
      height_segments: amount,
      width_segments: 1,
      randomness: 0.01,
    }),
    material: fire_slash_material({progress: 0.0}),
    position: position,
    rotation: new Vector3(Math.PI-Math.random()*Math.PI, Math.PI/2 - (position.yaw * Math.PI)/180.0, 0),
    scale: new Vector3(1, 1, 1),
  })

  let t = 0
  const interval = setInterval(() => {
    if (t > 1) {
      clearInterval(interval)
    } else {
      updateMaterial(fire_slash, fire_slash_material({progress: t}))
      render_particles(client, render_mesh(fire_slash))
    }
    t += speed
  }, 50)
}

export const spawn_firework = ({ client, position, max_radius, amount, speed = 0.01 }) => {
  const firework = mesh({
    geometry: sphere_geometry({
      radius: 0.1,
      height_segments: amount,
      width_segments: amount,
      randomness: 0.5,
    }),
    material: basic_material({color: {red: 0.2, green: 1, blue: 0.2}}),
    position: position,
    rotation: new Vector3(0, 0, 0),
    scale: new Vector3(1, 10, 1),
  })

  let t = 0
  const interval = setInterval(() => {
    if (t > 1) {
      clearInterval(interval)
    } else if (t > 0.1) {
      const radius =  max_radius*((t-0.1)/0.9)*10
      firework.scale = new Vector3(radius, radius, radius)
    } else {
      firework.position.y += speed*100
    }
    updateMaterial(firework, rainbow_material({progress: (t*2.2)%1}))
    updateTransformMatrix(firework)
    render_particles(client, render_mesh(firework))
    t += speed
  }, 50)
}

export const spawn_thunderbolts = ({ client, position, radius, speed = 0.01 }) => {
  const thunder_pattern = mesh({
    geometry: ring_geometry({
      min_radius: 1,
      max_radius: radius,
      segments: 4,
      center: new Vector3(0, 0, 0)
    }),
    material: basic_material({color: {red: 1, green: 1, blue: 1}, scale: 5}),
    position: position,
    rotation: new Vector3(Math.PI/2, 0, 0),
    scale: new Vector3(1, 1, 1),
  })

  const circle = mesh({
    geometry: circle_geometry({
      radius: radius,
      segments: 5*radius,
      center: new Vector3(0, 0, 0)
    }),
    material: basic_material({color: {red: 1, green: 1, blue: 1}, scale: 5}),
    position: position,
    rotation: new Vector3(Math.PI/2, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  
  const thunder_bolt = mesh({
    geometry: line_geometry({
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(0, -1, 0),
      length: 20,
      segments: 75,
    }),
    material: basic_material({color: {red: 1, green: 1, blue: 1}, scale: 5, particle_type: ParticlesTypes.SPARK}),
    position: position,
    rotation: new Vector3(0, 0, 0),
    scale: new Vector3(1, 1, 1),
  })

  let t = 0
  play_sound({client, sound: 'entity.lightning_bolt.thunder', ...position, volume: 7})
  const interval = setInterval(() => {
    if (t > 1) {
      clearInterval(interval)
    } else if (t > 0.7) {
      play_sound({client, sound: 'entity.lightning_bolt.impact', ...position, y: position.y-10})
      circle.material = basic_material({color: {red: 1, green: 1, blue: 1}, scale: 5})
      thunder_pattern.material = basic_material({color: {red: 1, green: 1, blue: 1}, scale: 5})
      updateMaterial(circle, circle.material)
      updateMaterial(thunder_pattern, thunder_pattern.material)
      const d = radius*((t-0.7)/0.3)
      thunder_bolt.position = {...position, x: position.x+d, z: position.z+0}
      updateTransformMatrix(thunder_bolt)
      render_particles(client, render_mesh(thunder_bolt))
      thunder_bolt.position = {...position, x: position.x+0, z: position.z+d}
      updateTransformMatrix(thunder_bolt)
      render_particles(client, render_mesh(thunder_bolt))
      thunder_bolt.position = {...position, x: position.x-d, z: position.z-0}
      updateTransformMatrix(thunder_bolt)
      render_particles(client, render_mesh(thunder_bolt))
      thunder_bolt.position = {...position, x: position.x-0, z: position.z-d}
      updateTransformMatrix(thunder_bolt)
      render_particles(client, render_mesh(thunder_bolt))
    } else if (t > 0.5) {
      circle.material = basic_material({color: {red: 1, green: 1, blue: 0}, scale: 5})
      thunder_pattern.material = basic_material({color: {red: 1, green: 1, blue: 0}, scale: 5})
      updateMaterial(circle, circle.material)
      updateMaterial(thunder_pattern, thunder_pattern.material)
    } else {
      thunder_pattern.rotation.z = (t/0.5)*Math.PI/2
      updateTransformMatrix(thunder_pattern)
    }
    render_particles(client, render_mesh(thunder_pattern).concat(render_mesh(circle)))
    t += speed
  }, 50)
}

/*export const spawn_lava_collumns = ({ client, position, max_radius, amount, speed = 0.01 }) => {
  const meshs = []
  for (let i = 0; i < 15; i++) {
    const lava_collumn = mesh({
      geometry: collumn_geometry({
        radius: 0.1,
        height: 10,
        center: new Vector3(0, -3, 0),
        segments: 1,
      }),
      material: lava_column_material({progress: 0}),
      position: {x: position.x+i*2, z: position.z+8+Math.random()*6, y: position.y},
      rotation: new Vector3(0, 0, 0),
      scale: new Vector3(1, 1, 1),
    })
    meshs[i] = lava_collumn
  }

  let t = 0
  const interval = setInterval(() => {
    if (t >= meshs.length+10) {
      clearInterval(interval)
    } else{
      for (let i = 0; i < meshs.length; i++) {
        updateMaterial(meshs[i], lava_column_material({progress: t-i/3}))
        render_particles(client, render_mesh(meshs[i]))
      }
    }
    t += 0.1
  }, 50)
}*/