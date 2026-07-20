// Local class roster for the offline Stage-0 visual (server delivers these in Stage 2).
// Public class names (Japanese) per SPEC.md / the reference-corpus SPEC.md. The private genre-inspiration
// class equivalents must NEVER surface in public ids/labels/assets.
//
// Characters render as the reused Koshi2D 2D directional pixel sprites (copied + renamed to the
// public ids under public/sprites/<id>/): `idle/<dir>.png` (8 compass directions) and
// `walk/<dir>/frame_000..005.png` (6-frame walk for the 5 base directions; the 3 west-facing
// directions are horizontal flips). `sprites` is the base path the sprite renderer reads.

/**
 * @typedef {{ id: string, name: string, title: string, sprites: string }} ClassTemplate
 */

/** @type {ClassTemplate[]} */
export const CLASS_TEMPLATES = [
  {
    id: 'senshi',
    name: 'Senshi',
    title: 'Warrior',
    sprites: '/sprites/senshi',
  },
  { id: 'yogen', name: 'Yogen', title: 'Archer', sprites: '/sprites/yogen' },
  {
    id: 'yajin',
    name: 'Yajin',
    title: 'Assassin',
    sprites: '/sprites/yajin',
  },
  {
    id: 'tomoda',
    name: 'Tomoda',
    // SPEC §7 removes summon effects; keep the public identity neutral instead of promising dead mechanics.
    title: 'Tomoda',
    sprites: '/sprites/tomoda',
  },
]

/** @param {string} id @returns {ClassTemplate | undefined} */
export const get_class = id => CLASS_TEMPLATES.find(c => c.id === id)
