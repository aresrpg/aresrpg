const INTERACTIVE_SELECTOR =
  'button, a[href], input, textarea, select, option, [contenteditable="true"], [role="button"], [role="dialog"]'

const event_path = (event) => {
  if (typeof event?.composedPath === 'function') return event.composedPath()
  return event?.target ? [event.target] : []
}

export function touch_hits_ui(event) {
  return event_path(event).some((node) => {
    if (!node || typeof node.matches !== 'function') return false
    return node.matches(INTERACTIVE_SELECTOR)
  })
}

/**
 * Admit a touchscreen pointer to an input-owned region. UI targets always win. `side: right` is the
 * roam-camera contract; the joystick already has a bounded lower-left DOM zone, so it uses `any`.
 * @param {PointerEvent | any} event
 * @param {{ active?: boolean, rect: { left:number, width:number }, side?: 'any'|'right' }} options
 */
export function accepts_touch_pointer(event, { active = true, rect, side = 'any' }) {
  if (!active || event?.pointerType !== 'touch' || touch_hits_ui(event)) return false
  if (side === 'right' && event.clientX < rect.left + rect.width / 2) return false
  return true
}
