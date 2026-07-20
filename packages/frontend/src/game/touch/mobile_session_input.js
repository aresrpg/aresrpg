import { is_mobile, on_mobile_change } from '../core/mobile_mode.js'
import {
  consume_look,
  consume_mount_toggle,
  consume_pinch,
  is_active,
  read_movement,
  set_armed,
  set_text_focused,
} from './touch_input.js'
import { create_touch_look } from './touch_look.js'
import { merge_movement_intent } from './movement_intent.js'

const TOUCH_LOOK_SENSITIVITY = 1.5
const TOUCH_DOLLY_METERS_PER_PX = 0.02

export function apply_touch_camera(camera, look, pinch) {
  if (look.dx || look.dy) camera.rotate(look.dx * TOUCH_LOOK_SENSITIVITY, look.dy * TOUCH_LOOK_SENSITIVITY)
  if (pinch) camera.dolly(-pinch * TOUCH_DOLLY_METERS_PER_PX)
}

/** Mobile-mode lifecycle and per-frame adapter around the app-owned player/camera input APIs. */
export function create_mobile_session_input({ canvas, camera, on_mount_toggle }) {
  let mobile = is_mobile()
  let look_driver = mobile ? create_touch_look(canvas) : null

  const set_mobile = (next) => {
    mobile = next
    if (next && !look_driver) look_driver = create_touch_look(canvas)
    if (!next && look_driver) {
      look_driver.dispose()
      look_driver = null
      set_armed(false)
    }
  }
  const unsubscribe_mobile = on_mobile_change(set_mobile)

  const feed = ({ text_has_focus, roam_armed }) => {
    if (!mobile) return
    set_text_focused(text_has_focus)
    set_armed(roam_armed)
    if (!is_active()) return
    apply_touch_camera(camera, consume_look(), consume_pinch())
    if (consume_mount_toggle()) on_mount_toggle()
  }

  const movement = (keys) => {
    const active = mobile && is_active()
    return merge_movement_intent(keys, active ? read_movement() : null, active)
  }

  const dispose = () => {
    look_driver?.dispose()
    unsubscribe_mobile()
    set_armed(false)
  }

  return { feed, movement, mobile: () => mobile, dispose }
}
