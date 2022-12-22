import { loadImage } from 'canvas'
import Vec3 from 'vec3'

import { direction_to_yaw_pitch, floor_pos, to_direction } from './math.js'
import {
  create_screen_canvas,
  destroy_screen,
  spawn_screen,
  update_screen,
} from './player/screen.js'
import { create_player } from './player_entity.js'
import { SCREENS } from './settings.js'

export const Menus = {
  equipment: {
    screen_id: SCREENS.player_screen,
    image: 'src/player/img/book_stats.png',
    clone_background: true,
  },
  book: {
    screen_id: SCREENS.player_screen,
    image: 'src/player/img/page_bleu.png',
  },
}

export async function display_menu({
  client,
  world,
  position,
  type,
  inventory = null,
  clone_id = null,
}) {
  const direction = to_direction(position.yaw, 0)
  if (Math.abs(direction.x) > Math.abs(direction.z)) {
    direction.z = 0
  } else {
    direction.x = 0
  }
  direction.normalize()
  const right = direction.cross(Vec3([0, 1, 0])).normalize()
  const screen_positon = Vec3(
    floor_pos(
      direction // global interface position
        .scaled(2)
        .add(position)
        .offset(0, 3, 0)
        .add(right.scaled(-3))
    )
  )

  const { canvas } = create_screen_canvas(world.screens.player_screen)
  const ctx = canvas.getContext('2d')

  const background_image = await loadImage(type?.image)
  ctx.drawImage(background_image, 0, 0, 128 * 6, 128 * 4)

  spawn_screen(
    { client, world },
    {
      screen_id: type.screen_id,
      position: screen_positon,
      direction: right.clone(),
    }
  )
  update_screen(
    { client, world },
    { screen_id: type.screen_id, new_canvas: canvas, old_canvas: null }
  )
  if (inventory && clone_id) {
    // spawn player clone
    const wielded_armor = inventory.slice(5, 9).reverse() // reversed to fit armor stand slots
    const equipement = [null, null, ...wielded_armor] // TODO: change null to equiped weapon
    create_player(
      client,
      clone_id,
      equipement,
      screen_positon
        .clone()
        .add(right.scaled(1.5))
        .offset(0, -1.75, 0)
        .add(direction.scaled(1.4)),
      (-direction_to_yaw_pitch(direction).yaw + (50 / 360) * 255) % 127,
      -direction_to_yaw_pitch(direction).yaw % 127
    )
  }

  if (type?.clone_background) {
    const { canvas: canvas2 } = create_screen_canvas(
      world.screens.clone_background
    )
    const ctx2 = canvas2.getContext('2d')
    ctx2.fillStyle = '#E3CFAF'
    ctx2.fillRect(0, 70, 128 * 3, 128 * 4)
    spawn_screen(
      { client, world },
      {
        screen_id: SCREENS.clone_background,
        position: screen_positon.add(direction.scaled(1)).offset(0, 1, 0),
        direction: right.clone(),
      }
    )
    update_screen(
      { client, world },
      {
        screen_id: SCREENS.clone_background,
        new_canvas: canvas2,
        old_canvas: null,
      }
    )
  }
}

export function destroy_menu(client, world, entityIds, screenIds) {
  client.write('entity_destroy', {
    entityIds,
  })

  screenIds.forEach(screen => {
    destroy_screen({ client, world }, { screen_id: screen })
  })
}
