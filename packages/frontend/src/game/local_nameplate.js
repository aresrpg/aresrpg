// D227 (the mob had no nameplate, and neither did the local player — lost in the migration) —
// THE LOCAL PLAYER'S NAMEPLATE. D206's projected chips were REMOTE-only (remote_players.js draws every
// presence entry); the local walker — rendered separately by embed_voxel — never got the legacy overhead
// plate back. One house chip (same style as the remote plates), projected off the live camera every frame
// by the EMBED's own loop (no second rAF — embed drives update()). Hidden while off-screen / pre-boot.

import { experience_to_level } from '@aresrpg/sdk/experience'

import { plate_occluded, project_plate } from './nameplate_occlusion.js'
import { context } from './store.js'

// faded target when the plate sits behind world geometry (a faint ghost, not fully gone — you still sense
// the wearer). The CSS transition on `opacity` (added to the chip below) turns the toggle into a soft fade.
const OCCLUDED_OPACITY = '0.18'

/** The plate's "NAME · LV N" text for a roster row — the level DERIVED from the LIVE on-chain experience through
 *  experience_to_level (the ONE level-curve home, so the plate agrees with the Stats sheet + the level-up card).
 *  Falls back to the row's projected `level` (then 1) before an experience is known. @param {any} character */
const plate_label = (character) => {
  const level = character?.experience != null ? experience_to_level(character.experience) : (character?.level ?? 1)
  return `${character?.name || 'ME'} · LV ${level}`
}

/**
 * @param {{ engine: any, canvas?: HTMLElement | null, character: any }} args character = the in-hand session
 *   roster row (its id keys the live-level subscription; name + experience seed the label); canvas = the WORLD
 *   canvas (D232 — a bare querySelector can grab the pedestal/drawer canvas and shift the plate off the head).
 * @returns {{ update: (x: number, y: number, z: number) => void, set_hidden: (h: boolean) => void, dispose: () => void }}
 */
export function create_local_nameplate({ engine, canvas = null, character }) {
  const chip = document.createElement('div')
  // NAMEPLATE HIERARCHY: player plates look different and more prominent than mob
  // ones — the SAME bolder treatment remote_players.js gives other players (bigger 12px/700-weight
  // text, a solid gold #c8963c border instead of the mob card's 50%-translucent one, an ambient gold-glow
  // box-shadow): one visual language for "this is a player," local or remote.
  chip.style.cssText =
    'position:fixed;transform:translate(-50%,-100%);padding:5px 11px;white-space:nowrap;z-index:11;' + // z law: canvas=11, HUD=12 (D227)
    'pointer-events:none;font:700 12px/1.2 "JetBrains Mono",monospace;letter-spacing:.16em;' +
    'text-transform:uppercase;color:#f5d0a9;background:rgba(10,10,15,.85);' +
    'border:1.5px solid #c8963c;text-shadow:0 0 8px rgba(200,150,60,.8),0 1px 2px rgba(0,0,0,.9);' +
    'box-shadow:0 0 16px rgba(200,150,60,.35);display:none;' +
    'transition:opacity .18s ease' // occlusion fade (behind geometry → OCCLUDED_OPACITY)
  let label = plate_label(character)
  chip.textContent = label
  document.body.appendChild(chip)
  let hidden = false // TR-1 v2 — force-hidden while the cinematic camera records (clean footage)
  const projected = { left: 0, top: 0 }

  // D227 LEVEL REFRESH (a nametag stuck showing lvl 1 after REACHED LEVEL 2) — the label was captured
  // ONCE at avatar-mount and never moved again, so a post-fight level-up (the store's floored experience) never
  // reached the plate. Subscribe to the live roster: repaint "LV N" the moment the reconciled experience lands.
  // Cheap + guarded (writes the DOM only when the text actually changes); STATE_UPDATED is the right grain (not
  // per-frame). The character passed in is a mount-time snapshot; the live row (by id) is the source of truth.
  const on_state = (/** @type {any} */ state) => {
    const live = state?.sui?.characters?.find((/** @type {any} */ c) => c.id === character?.id) ?? character
    const next = plate_label(live)
    if (next === label) return
    label = next
    chip.textContent = next
  }
  context.events.on('STATE_UPDATED', on_state)

  return {
    /** Project the plate anchor (head + margin, world) → screen. Call once per frame from the embed loop. */
    update(x, y, z) {
      if (hidden) return // stays display:none (set by set_hidden) — no projection while recording
      const cam = engine.get_camera?.()
      if (!cam) return
      // D227/D232: NDC maps through the WORLD canvas rect (passed in — querySelector could hit another canvas)
      const cv = canvas ?? /** @type {HTMLElement | null} */ (document.querySelector('canvas'))
      const rect = cv?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      }
      // the ONE shared plate projector (nameplate_occlusion.js): world-locked — the shoulder rig's synthetic
      // head-bob is cancelled at source so the plate never swims on run/jump — and
      // behind-camera culled. This path only paints the pixel + the occlusion fade.
      const px = project_plate(cam, rect, x, y, z, projected)
      chip.style.display = px ? 'block' : 'none'
      if (!px) return
      chip.style.left = `${px.left}px`
      chip.style.top = `${px.top}px`
      // occlusion: fade when a hill/wall sits between the head anchor and the camera (cheap voxel march).
      chip.style.opacity = plate_occluded(engine, x, y, z, cam) ? OCCLUDED_OPACITY : '1'
    },
    /** TR-1 v2 — hide/show the plate for cinematic recording (clean footage). @param {boolean} h */
    set_hidden(h) {
      hidden = !!h
      if (hidden) chip.style.display = 'none'
    },
    dispose() {
      context.events.off('STATE_UPDATED', on_state) // stop tracking the live level with the session
      chip.remove()
    },
  }
}
