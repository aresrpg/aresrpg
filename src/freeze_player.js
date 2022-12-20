import { create_armor_stand } from './armor_stand.js'
import { PLAYER_ENTITY_ID } from './settings.js'

export default function freeze_player(client, armorstand_id, { x, y, z }) {
  create_armor_stand(client, armorstand_id, {
    x: Math.floor(x),
    y: y + 0.5,
    z: Math.floor(z),
  })
  client.write('set_passengers', {
    entityId: armorstand_id,
    passengers: [PLAYER_ENTITY_ID],
  })
}
