// DOUBLE-CLICK CURSOR LOCK: double click keeps the cursor locked for more comfortable exploration,
// double click again or echap to unlock, same toast as 'cinematic mode on'. A STICKY companion to the
// shoulder rig's existing HOLD-drag pointer lock (engine/player/pointer_lock.js — hold LMB, drag past the
// threshold, release exits): double-clicking the world canvas requests native Pointer Lock directly on the
// SAME element the rig is attached to (embed_voxel_player.js's `cam.attach(canvas)`). The rig's own
// PointerLockControls reads `document.pointerLockElement` (not who asked for it) to decide whether to
// free-feed movementX/Y into the camera rotate — so the instant this lock engages, the EXACT same orbit
// math takes over: zero new camera code, just the input source swapping from the hold-drag gesture to the
// raw locked mouse. pointer_lock.js's own mouseup release is gated to its OWN requested lock (see that
// file's `self_requested` comment) precisely so an ordinary gameplay click released while THIS lock is up
// can never silently kick it back out.
//
// Exit: double-click again, OR anything that force-drops native pointer lock (Esc, tab-switch, dev-tools).
// `pointerlockchange` is the ONLY source of truth for "are we still locked" — never a parallel boolean that
// could drift out of sync with the browser's own state.
//
// `engaged` below is NOT a duplicate of that truth — every dblclick and every pointerlockchange handler
// re-reads `document.pointerLockElement` live. `engaged` only tracks PROVENANCE: did OUR double-click
// toggle put this exact lock up, so the shoulder rig's own transient hold-drag locks (engaged/released many
// times a minute during normal play) never fire this toast — only this deliberate sticky toggle does.
//
// Plain DOM helper (no three, no toast/i18n, no store) — the caller (embed_voxel_player.js, exactly like
// its own toggle_cinematic) owns the toast text; this only reports `on_change(locked)`.

/**
 * @param {{ canvas: HTMLCanvasElement, is_fight: () => boolean, on_change: (locked: boolean) => void }} deps
 * @returns {{ dispose: () => void }}
 */
export function create_cursor_lock_toggle({ canvas, is_fight, on_change }) {
  let engaged = false // true while OUR dblclick sticky lock (not a hold-drag) owns the current lock
  let requesting = false // dblclick just called requestPointerLock(); awaiting the browser's confirming event

  const on_dblclick = () => {
    if (is_fight()) return // fight boards keep their own click semantics (D230) — never toggle mid-fight
    if (canvas.ownerDocument.pointerLockElement === canvas) {
      canvas.ownerDocument.exitPointerLock?.() // 2nd double-click — on_lock_change below confirms + toasts
      return
    }
    requesting = true
    try {
      const p = canvas.requestPointerLock?.()
      if (p && typeof p.catch === 'function')
        p.catch(() => {
          requesting = false // rejected (rare — e.g. mid-navigation) — swallow, never surfaces unhandled
        })
    } catch {
      requesting = false // older browsers throw synchronously
    }
  }

  const on_lock_change = () => {
    const locked = canvas.ownerDocument.pointerLockElement === canvas
    if (locked && requesting) {
      requesting = false
      engaged = true
      on_change(true)
    } else if (!locked && engaged) {
      // one path for every exit cause: our own 2nd dblclick, Esc, tab-switch, dev-tools
      engaged = false
      on_change(false)
    }
  }

  canvas.addEventListener('dblclick', on_dblclick)
  canvas.ownerDocument.addEventListener('pointerlockchange', on_lock_change)

  return {
    dispose() {
      canvas.removeEventListener('dblclick', on_dblclick)
      canvas.ownerDocument.removeEventListener('pointerlockchange', on_lock_change)
      if (engaged && canvas.ownerDocument.pointerLockElement === canvas) canvas.ownerDocument.exitPointerLock?.()
      engaged = false
      requesting = false
    },
  }
}
