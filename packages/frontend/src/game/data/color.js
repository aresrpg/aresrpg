// Shared cosmetic-colour helpers. The on-chain `color_1` is stored as a packed 24-bit RGB NUMBER
// (Move u32 → indexer u32 → FalkorDB property), and the sprite renderer wants a skin hue in degrees
// [0..360]. `color_to_hue` is the single source of truth for that conversion — used by the local
// player (character-select) and by foreign players (presence module).

/** packed 0xRRGGBB number → hue degrees [0..360]. @param {number} color @returns {number} */
export const color_to_hue = color => {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let hue
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue *= 60
  return hue < 0 ? hue + 360 : hue
}
