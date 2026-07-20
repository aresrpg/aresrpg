// Movement input for demo walk mode (ENG-8) — a pure DOM listener → axis state, ported 1:1 in spirit
// from packages/frontend player-controller.js (mouse OR keys, never click-to-move). Keys: WASD + ZQSD
// (AZERTY) + arrows; Space = jump; holding BOTH mouse buttons = forward (the legacy "both-buttons run"
// convention). Shift = walk (slow) — the run/walk modifier. blur clears held state so an alt-tab
// mid-press never leaves a phantom key stuck. Zero engine/world coupling.

const FORWARD_KEYS = new Set(['KeyW', 'KeyZ', 'ArrowUp'])
const BACKWARD_KEYS = new Set(['KeyS', 'ArrowDown'])
const LEFT_KEYS = new Set(['KeyA', 'KeyQ', 'ArrowLeft'])
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight'])
const JUMP_KEYS = new Set(['Space'])
const WALK_KEYS = new Set(['ShiftLeft', 'ShiftRight'])

/**
 * @typedef {object} MovementInput
 * @property {() => { forward: number, strafe: number, jump: boolean, walk: boolean }} get_axis current
 *   intent: forward/strafe ∈ {-1,0,1}, jump/walk booleans.
 * @property {(target: HTMLElement) => void} attach binds listeners (target receives mouse-hold-forward).
 * @property {() => void} detach removes them.
 */

/** @returns {MovementInput} */
export function create_movement_input() {
  /** @type {Set<string>} */
  const keys = new Set()
  let mouse_left = false
  let mouse_right = false
  /** @type {HTMLElement | null} */
  let target = null

  const on_keydown = (/** @type {KeyboardEvent} */ e) => {
    if (JUMP_KEYS.has(e.code)) e.preventDefault() // Space must not scroll / click a focused button
    keys.add(e.code)
  }
  const on_keyup = (/** @type {KeyboardEvent} */ e) => keys.delete(e.code)
  const on_mousedown = (/** @type {MouseEvent} */ e) => {
    if (e.button === 0) mouse_left = true
    else if (e.button === 2) mouse_right = true
  }
  const on_mouseup = (/** @type {MouseEvent} */ e) => {
    if (e.button === 0) mouse_left = false
    else if (e.button === 2) mouse_right = false
  }
  const on_blur = () => {
    keys.clear()
    mouse_left = false
    mouse_right = false
  }
  const on_contextmenu = (/** @type {MouseEvent} */ e) => e.preventDefault() // right-drag shouldn't menu

  const any_held = (/** @type {Set<string>} */ set) => {
    for (const code of set) if (keys.has(code)) return true
    return false
  }

  return {
    get_axis() {
      let forward = 0
      if (any_held(FORWARD_KEYS) || (mouse_left && mouse_right)) forward += 1
      if (any_held(BACKWARD_KEYS)) forward -= 1
      let strafe = 0
      if (any_held(RIGHT_KEYS)) strafe += 1
      if (any_held(LEFT_KEYS)) strafe -= 1
      return { forward, strafe, jump: any_held(JUMP_KEYS), walk: any_held(WALK_KEYS) }
    },
    attach(el) {
      target = el
      window.addEventListener('keydown', on_keydown)
      window.addEventListener('keyup', on_keyup)
      el.addEventListener('mousedown', on_mousedown)
      window.addEventListener('mouseup', on_mouseup)
      el.addEventListener('contextmenu', on_contextmenu)
      window.addEventListener('blur', on_blur)
    },
    detach() {
      window.removeEventListener('keydown', on_keydown)
      window.removeEventListener('keyup', on_keyup)
      target?.removeEventListener('mousedown', on_mousedown)
      window.removeEventListener('mouseup', on_mouseup)
      target?.removeEventListener('contextmenu', on_contextmenu)
      window.removeEventListener('blur', on_blur)
      target = null
    },
  }
}
