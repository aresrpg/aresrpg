import UUID from 'uuid-1345'
import fs from 'fs'
const worldMobsDatas = JSON.parse(fs.readFileSync('./src/worldMobsSpawn/worldMobsDatas.json', 'utf8'))

let worlMobs = new Array()

let mobsType = {
  villager:93,
  poule1:9,
  poulemalade:9,
  pouletmoine:9,
  loup1:99,
  loupaffame:99
}

export function worldMobsSpawn({ client, events, position }) {
  console.log("worldMobsSpawn.js loaded !")
  
  events.on('chunk_loaded', (evt) => {
    console.log(evt)
  })

  for (var m of worldMobsDatas) {
    let mob = {
      entityId: m.id+1000,
      entityUUID: UUID.v4(),
      type: (mobsType[m.mob] != undefined) ? mobsType[m.mob] : 7, // if not found spawn a cat
      x: m.position.x,
      y: m.position.y,
      z: m.position.z,
      yaw: 0,
      pitch: 0,
      headPitch: 0,
      velocityX: 1,
      velocityY: 1,
      velocityZ: 0
    }
    client.write('spawn_entity_living', mob)
   
  }
}