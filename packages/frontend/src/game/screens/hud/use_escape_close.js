// Close-on-anywhere for transient context menus (pet / loot-box): while `open` is truthy, any window
// click or Escape fires `on_close`. Extracted from Inventory.jsx's two byte-identical effects (one home).
import { useEffect } from 'react'

/** @param {unknown} open @param {() => void} on_close */
export function use_escape_close(open, on_close) {
  useEffect(() => {
    if (!open) return undefined
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('click', on_close)
    window.addEventListener('keydown', on_key)
    return () => {
      window.removeEventListener('click', on_close)
      window.removeEventListener('keydown', on_key)
    }
  }, [open, on_close])
}
