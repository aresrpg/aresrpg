import UUID from 'uuid-1345'
import fs from 'fs'
import minecraftData from 'minecraft-data'
import { version } from '../settings.js'
const worldMobsDatas = JSON.parse(fs.readFileSync('./src/worldMobs/worldMobsDatas.json', 'utf8'))
import { mobsType_mobsName } from './mobsType_mobsName.js'

const mcData = minecraftData(version)

//let worlMobs = new Array()

export function worldMobsSpawn({ client, events, position }) {
  console.log("worldMobsSpawn.js loaded !")

  events.on('chunk_loaded', (evt) => {
    //console.log(evt)

    /*chunk_position(x)
    chunk_position(y)*/
  })

  //client.on('position', console.log)

  for(let i=0;i<worldMobsDatas.length;i++) {
    let mob = {
      entityId: i+1000, // TODO: fix id assignement
      entityUUID: UUID.v4(),
      //type: (mobsType_mobsName[worldMobsDatas[i].mob] != undefined) ? mobsType_mobsName[worldMobsDatas[i].mob] : 7, // if not found spawn a cat
      type: mcData.entitiesByName[mobsType_mobsName[worldMobsDatas[i].mob].type].id,
      x: worldMobsDatas[i].position.x,
      y: worldMobsDatas[i].position.y,
      z: worldMobsDatas[i].position.z,
      yaw: 0,
      pitch: 0,
      headPitch: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0
    }

    let metadata = {
      entityId: i+1000, // TODO: fix id assignement
      metadata: [
        {
          key: 2,
          value: JSON.stringify({text: mobsType_mobsName[worldMobsDatas[i].mob].displayName, color: "white", extra: [{text: " [ " + worldMobsDatas[i].level + " ] ", color: "red"}]}),
          type: 5 /* OptChat */
        },
        {
          key: 3,
          type: 7,
          value: true
        }/*, // just for fun
        {
          key:0,
          type:0,
          value:0x40 | 0x01
        }*/
      ]
    }

    client.write('spawn_entity_living', mob)
    client.write('entity_metadata', metadata)
  }
}
