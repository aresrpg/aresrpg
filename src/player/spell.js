import Items from '../../data/items.json' assert { type: 'json' }
import { Action, Context } from '../events.js'
import { mesh, spawn_particle } from './particles/particles.js'
import { circle_geometry, ring_geometry } from './particles/geometries.js'
import { basic_material } from './particles/materials.js'
import { to_slot } from './inventory.js'
import vecmath from 'vecmath'

import logger from '../logger.js'
import { spawn_thunderbolts } from './spells/animations.js'
const log = logger(import.meta)
const { Vector3 } = vecmath
const visible_mobs = {}

const HOTBAR_OFFSET = 36
const Hand = {
  MAINHAND: 0,
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, dispatch, world, events }) {

    events.on(Context.MOB_SPAWNED, ({mob}) => {
      visible_mobs[mob.entity_id] = mob
    })
    events.on(Context.MOB_DESPAWNED, ({entity_id}) => {
      delete visible_mobs[entity_id]
    })

    client.on('use_item', ({ hand }) => {
      if (hand === Hand.MAINHAND) {
        const { inventory, held_slot_index } = get_state()
        const slot_number = held_slot_index + HOTBAR_OFFSET
        const item = inventory[slot_number]
        const state = get_state()
        if (item && state.health > 0) {
          const { type } = item
          const itemData = Items[type]
          log.info(itemData, "ItemData")
          if (itemData.type === 'spellbook') {
            test_aoe(client, get_state)
            dispatch(Action.CAST_SPELL, {

            })
          }
        }
      }
    })
  }
}

function test_aoe(client, get_state) {
  const {inventory, position, held_slot_index} = get_state()
  const circle1 = mesh({
    geometry: circle_geometry({
    radius: 2,
    segments: 20,
    center: { x: 0, y: 0, z: 0 },
    }),
    material: basic_material({
      color: { red: 1.0, green: 0.5, blue: 0.2 },
      scale: 3,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  const circle2 = mesh({
    geometry: circle_geometry({
    radius: 3.5,
    segments: 35,
    center: { x: 0, y: 0, z: 0 },
    }),
    material: basic_material({
      color: { red: 1.0, green: 0.5, blue: 0.2 },
      scale: 3,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  const circle3 = mesh({
    geometry: circle_geometry({
    radius: 5,
    segments: 50,
    center: { x: 0, y: 0, z: 0 },
    }),
    material: basic_material({
      color: { red: 1.0, green: 0.5, blue: 0.2 },
      scale: 3,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  const crack1 = mesh({
    geometry: ring_geometry({
      min_radius: 0.5,
      max_radius: 2,
      center: { x: 0, y: 0, z: 0 },
      segments: 3,
    }),
    material: basic_material({
      color: { red: 0.9, green: 0.7, blue: 0.2 },
      scale: 2,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  
  const crack2 = mesh({
    geometry: ring_geometry({
      min_radius: 0.5,
      max_radius: 3.5,
      center: { x: 0, y: 0, z: 0 },
      segments: 6,
    }),
    material: basic_material({
      color: { red: 0.9, green: 0.7, blue: 0.2 },
      scale: 2,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  
  const crack3 = mesh({
    geometry: ring_geometry({
      min_radius: 0.5,
      max_radius: 5,
      center: { x: 0, y: 0, z: 0 },
      segments: 9,
    }),
    material: basic_material({
      color: { red: 0.9, green: 0.7, blue: 0.2 },
      scale: 2,
    }),
    position: new Vector3(position.x, position.y, position.z),
    rotation: new Vector3(Math.PI*0.5, 0, 0),
    scale: new Vector3(1, 1, 1),
  })
  
  
  //spawn_sword_slash({client, position: {...position, y: position.y+1}, radius: 3, amount: 30})
  //spawn_firework({client, position: {...position, x: position.x+15, y: position.y+1}, max_radius: 20, amount: 10})
  //spawn_thunderbolts({client, position: {...position, x: position.x, y: position.y+20}, radius: 20})
  
  /*spawn_particle(client, {
    particle_id: 49,
    position,
    data: {item_id: 1},
    long_distance: false,
    offset: {offsetX: 0, offsetY: 0, offsetZ: 0}
  })*/

  /* ---Totem Animation---
  const old_item = inventory[HOTBAR_OFFSET+held_slot_index+1]
  const temp_item = to_slot(old_item)
  temp_item.itemId = 904
  temp_item.nbtData.value.CustomModelData.value = 100
  delete temp_item.nbtData.value.Enchantments
  log.info(temp_item.nbtData, 'temp_item')
  client.write('set_slot', {
    windowId: 0,
    slot: HOTBAR_OFFSET+held_slot_index,
    item: temp_item,
  })
  client.write('entity_status', {
    entityId: client.entity_id,
    entityStatus: 35
  })
  client.write('set_slot', {
    windowId: 0,
    slot: HOTBAR_OFFSET+held_slot_index,
    item: to_slot(inventory[HOTBAR_OFFSET+held_slot_index]),
  })*/
}

/*function cast_spell_effect({component}) {
  return {
    component,
    run: ({client, mob}) => {
      cast_spell(client, component, mob.position())
    }
  }
}

function damage_effect({damage}) {
  return {
    damage,
    run: ({client, mob}) => {
      mob.dispatch(MobAction.DEAL_DAMAGE, {
        damage: damage,
        damager: client.uuid,
      })
    }
  }
}

function sphere_shape({radius}) {
  return {
    is_colliding: (spell_pos, mob_pos) => {
      return new Vector3(spell_pos.x, spell_pos.y, spell_pos.z).distance(mob_pos) < radius
    }
  }
}

function aoe_component({shape, mesh, effect}) {
  return {
    shape,
    mesh,
    effect,
    run: (data) => {
      const {spell_pos} = data
      
      for (const key in visible_mobs) {
        const mob = visible_mobs[key]
        const { category } = Entities[mob.type]
        if (mob?.get_state()?.health && category !== 'npc') {
          if (shape.is_colliding(spell_pos, mob.position())) {
            effect.run({mob, ...data})
          }
        }
      }
    }
  }
}

function multi_component({components, delay}) {
  return {
    components,
    delay,
    run: (data) => {
      const {client} = data
      let step = 0
      components[step].run(data)
      render_particles(client, components[step].mesh)
      const interval = setInterval(() => {
        step++
        if (step < components.length) {
          components[step].run(data)
          render_particles(client, components[step].mesh)
        } else clearInterval(interval)
      }, delay)
    }
  }
}

function cast_spell(client, component, position) {
  const data = {
    client,
    spell_pos: position,
  }
  component.run(data)
  render_particles(client, component.mesh)
}*/