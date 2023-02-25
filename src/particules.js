import minecraftData from 'minecraft-data'

import { VERSION } from './settings.js'

const {
  blocksByName: { redstone_wire },
  particlesByName: { dust, block },
} = minecraftData(VERSION)

export function show_blood({ client, position }) {
  client.write('world_particles', {
    particleId: block.id,
    longDistance: false,
    ...position,
    offsetX: 0.1,
    offsetY: 0.1,
    offsetZ: 0.1,
    particleData: 0.5, // maxspeed
    particles: 30, // particles count
    data: {
      blockState: redstone_wire.defaultState,
    },
  })
}

// a custom black minimal death smoke
// will be useful for non vanilla entity
// and is not that bad combined with the default white smoke for vanilla entities
export function show_death_smoke({ client, position }) {
  client.write('world_particles', {
    particleId: dust.id,
    longDistance: false,
    ...position,
    offsetX: 0.5,
    offsetY: 0.5,
    offsetZ: 0.5,
    particleData: 1.5, // maxspeed
    particles: 20, // particles count
    data: {
      red: 0,
      green: 0,
      blue: 0,
      scale: 2,
    },
  })
}
