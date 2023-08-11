import { speak_to } from '../core/entity_dialog.js'

/** @type {import('../server').Module} */
export default {
  observe({ client, world }) {
    const right_click = 2
    client.on('use_entity', ({ target, mouse, sneaking }) => {
      if (mouse === right_click && sneaking === false) {
        const mob = world.mob_by_entity_id(target)
        if (mob) {
          speak_to(mob, { client })
        }
      }
    })
  },
}
