import UUID from 'uuid-1345'
import fs from 'fs'
import minecraftData from 'minecraft-data'
import { version } from '../settings.js'
const worldMobsDatas = JSON.parse(fs.readFileSync('./src/worldMobs/worldMobsDatas.json', 'utf8'))
import { mobsType_mobsName } from './mobsType_mobsName.js'
import { chunk_position } from '../chunk.js'

const mcData = minecraftData(version)

let worlMobs = new Array()

export function worldMobsSpawn({ client, events, position }) {
  console.log("worldMobsSpawn.js loaded !")

  events.on('chunk_loaded', (evt) => {
    //console.log(evt)

    for(let i=0;i<worldMobsDatas.length;i++) {
      if(worlMobs.indexOf(i) == -1 && (chunk_position(worldMobsDatas[i].position.x) == evt.x  && chunk_position(worldMobsDatas[i].position.z) == evt.z)) {
        //console.log(worldMobsDatas[i].mob)

        let mob = {
          entityId: i+1000, // TODO: fix id assignement
          entityUUID: UUID.v4(),
          type: mcData.entitiesByName[(mobsType_mobsName[worldMobsDatas[i].mob].type != '') ? mobsType_mobsName[worldMobsDatas[i].mob].type : 'cat'].id,
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

        //console.log("Entity \"" + mobsType_mobsName[worldMobsDatas[i].mob].displayName + " [ " + worldMobsDatas[i].level + " ] " + "\" loaded !")
      }
    }

    /*chunk_position(x)
    chunk_position(y)*/
  })
}
