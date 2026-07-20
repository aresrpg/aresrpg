// The ONE tooltip-positioning derivation (extracted from Tooltip.jsx so the same math anchors the house Tooltip
// AND the fight spell-bar readout — design ruling 2026-07-20: a tooltip of the spell itself, not on the right). Pure: measured
// rects in → viewport-clamped { left, top } out. Preferred side is `placement`; it edge-FLIPS to the other side
// when that would clip off-screen, then clamps both axes inside the viewport margin. Coordinates are viewport
// pixels (the card is portalled to <body>), so callers pass getBoundingClientRect boxes directly.

export const GAP = 8 // px between the trigger and the card
export const MARGIN = 8 // px minimum distance from the viewport edge

/**
 * @param {{
 *   trigger: { left: number, top: number, bottom: number, width: number, height: number },
 *   card: { width: number, height: number },
 *   viewport: { width: number, height: number },
 *   placement?: 'top' | 'bottom',
 *   gap?: number,
 *   margin?: number,
 * }} params
 * @returns {{ left: number, top: number }}
 */
export const tooltip_anchor = ({ trigger, card, viewport, placement = 'top', gap = GAP, margin = MARGIN }) => {
  const { width: vw, height: vh } = viewport
  let top = placement === 'bottom' ? trigger.bottom + gap : trigger.top - card.height - gap
  // vertical edge-flip: if the preferred side clips, flip to the other side
  if (placement !== 'bottom' && top < margin) top = trigger.bottom + gap
  if (placement === 'bottom' && top + card.height > vh - margin) top = trigger.top - card.height - gap

  let left = trigger.left + trigger.width / 2 - card.width / 2
  left = Math.max(margin, Math.min(left, vw - card.width - margin))
  top = Math.max(margin, Math.min(top, vh - card.height - margin))

  return { left, top }
}
